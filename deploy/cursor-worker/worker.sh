#!/usr/bin/env bash
# Poll inbox for *.json jobs and run Cursor CLI headlessly.
# Job JSON example:
# {
#   "id": "deck-001",
#   "prompt": "Create a 6-slide PowerPoint about fibre rollout governance...",
#   "createdAt": "2026-08-01T12:00:00Z"
# }
set -euo pipefail

export PATH="/opt/cursor-worker/.local/bin:${PATH}"

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

    prompt="$(python3 - <<'PY' "$processing"
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(data.get("prompt") or data.get("brief") or "")
PY
)"

    if [[ -z "$prompt" ]]; then
      echo "Empty prompt in $base" | tee -a "$log"
      mv "$processing" "${done_dir}/request.json"
      echo '{"status":"error","error":"empty prompt"}' > "${done_dir}/result.json"
      continue
    fi

    # Ask agent to write outputs into the job outbox folder
    full_prompt="$prompt

Save any generated files under: ${done_dir}
Prefer creating a PowerPoint (.pptx) when the request is for a presentation.
When finished, write a short summary to ${done_dir}/summary.txt
"

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
      echo "{\"status\":\"ok\",\"finishedAt\":\"$(date -u +%FT%TZ)\"}" > "${done_dir}/result.json"
    else
      echo "{\"status\":\"error\",\"exitCode\":$status,\"finishedAt\":\"$(date -u +%FT%TZ)\"}" > "${done_dir}/result.json"
    fi
    echo "[$(date -u +%FT%TZ)] Finished $base status=$status" | tee -a "$log"
  done

  sleep "$POLL_SECONDS"
done
