#!/usr/bin/env bash
# Poll inbox for *.json jobs and run Cursor CLI headlessly.
# Job JSON example:
# {
#   "id": "deck-001",
#   "type": "draft" | "generate",
#   "prompt": "...",
#   "attachments": [{"name":"...", "path":"/opt/cursor-worker/attachments/..."}],
#   "createdAt": "2026-08-01T12:00:00Z"
# }
set -euo pipefail

export PATH="/opt/cursor-worker/.venv/bin:/opt/cursor-worker/.local/bin:${PATH}"

ENV_FILE="${CURSOR_ENV_FILE:-/etc/pragmatict/cursor.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

INBOX="${CURSOR_INBOX:-/opt/cursor-worker/inbox}"
OUTBOX="${CURSOR_OUTBOX:-/opt/cursor-worker/outbox}"
WORK_DIR="${CURSOR_WORK_DIR:-/opt/cursor-worker/work}"
LOG_DIR="${CURSOR_LOG_DIR:-/opt/cursor-worker/logs}"
POLL_SECONDS="${CURSOR_POLL_SECONDS:-15}"

mkdir -p "$INBOX" "$OUTBOX" "$WORK_DIR" "$LOG_DIR"

echo "[$(date -u +%FT%TZ)] cursor-worker started (poll=${POLL_SECONDS}s)"

while true; do
  shopt -s nullglob
  jobs=("$INBOX"/*.json)
  shopt -u nullglob

  for job in "${jobs[@]}"; do
    base="$(basename "$job" .json)"
    processing="${INBOX}/${base}.processing"
    done_dir="${OUTBOX}/${base}"
    log="${LOG_DIR}/${base}.log"

    if ! mv "$job" "$processing" 2>/dev/null; then
      continue
    fi

    echo "[$(date -u +%FT%TZ)] Processing $base" | tee -a "$log"
    mkdir -p "$done_dir"

    meta_dir="$(mktemp -d)"
    set +e
    python3 - <<'PY' "$processing" "$done_dir" "$meta_dir"
import json, sys, shutil
from pathlib import Path

processing = Path(sys.argv[1])
done_dir = Path(sys.argv[2])
meta_dir = Path(sys.argv[3])
try:
    with processing.open(encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    print(f"__JSON_ERROR__:{e}", file=sys.stderr)
    sys.exit(2)

job_type = (data.get("type") or "generate").strip().lower()
prompt = data.get("prompt") or data.get("brief") or ""

atts = data.get("attachments") or []
staged = []
if isinstance(atts, list) and atts:
    dest_root = done_dir / "attachments"
    dest_root.mkdir(parents=True, exist_ok=True)
    for a in atts:
        if not isinstance(a, dict):
            continue
        src = Path(str(a.get("path") or ""))
        name = str(a.get("name") or src.name or "file")
        if src.is_file():
            target = dest_root / name
            try:
                shutil.copy2(src, target)
                staged.append(str(target))
            except Exception as e:
                print(f"attach-copy-fail:{name}:{e}", file=sys.stderr)

(meta_dir / "type.txt").write_text(job_type, encoding="utf-8")
(meta_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
(meta_dir / "staged.txt").write_text("\n".join(staged), encoding="utf-8")
PY
    parse_status=$?
    set -e

    if [[ $parse_status -ne 0 ]]; then
      echo "Invalid JSON in $base" | tee -a "$log"
      rm -rf "$meta_dir"
      mv "$processing" "${done_dir}/request.json"
      echo '{"status":"error","error":"invalid json"}' > "${done_dir}/result.json"
      continue
    fi

    job_type="$(cat "${meta_dir}/type.txt")"
    prompt="$(cat "${meta_dir}/prompt.txt")"
    staged_paths="$(cat "${meta_dir}/staged.txt")"
    rm -rf "$meta_dir"

    if [[ -z "$prompt" ]]; then
      echo "Empty prompt in $base" | tee -a "$log"
      mv "$processing" "${done_dir}/request.json"
      echo '{"status":"error","error":"empty prompt"}' > "${done_dir}/result.json"
      continue
    fi

    attach_note=""
    if [[ -n "$staged_paths" ]]; then
      attach_note="
Staged copies of attachments are also under: ${done_dir}/attachments/
"
    fi

    if [[ "$job_type" == "draft" ]]; then
      full_prompt="$prompt
${attach_note}
IMPORTANT: This is a DRAFT-ONLY job. Do NOT create a .pptx file.
Save the full slide outline/text as: ${done_dir}/draft.md
When finished, write a short summary to ${done_dir}/summary.txt
"
    else
      full_prompt="$prompt
${attach_note}
Save any generated files under: ${done_dir}
Create a PowerPoint (.pptx) for this generation job.
Also save the final slide text as ${done_dir}/draft.md for continuity.
When finished, write a short summary to ${done_dir}/summary.txt
"
    fi

    set +e
    /opt/cursor-worker/.local/bin/agent -p --force --trust \
      --output-format text \
      --workspace "$WORK_DIR" \
      --api-key "${CURSOR_API_KEY}" \
      "$full_prompt" 2>&1 | tee -a "$log"
    status=${PIPESTATUS[0]}
    set -e

    mv "$processing" "${done_dir}/request.json"
    if [[ $status -eq 0 ]]; then
      echo "{\"status\":\"ok\",\"type\":\"${job_type}\",\"finishedAt\":\"$(date -u +%FT%TZ)\"}" > "${done_dir}/result.json"
    else
      echo "{\"status\":\"error\",\"type\":\"${job_type}\",\"exitCode\":$status,\"finishedAt\":\"$(date -u +%FT%TZ)\"}" > "${done_dir}/result.json"
    fi
    echo "[$(date -u +%FT%TZ)] Finished $base type=$job_type status=$status" | tee -a "$log"
  done

  sleep "$POLL_SECONDS"
done
