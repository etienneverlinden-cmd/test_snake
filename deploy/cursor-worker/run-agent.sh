#!/usr/bin/env bash
# Run a one-shot headless Cursor agent job.
set -euo pipefail

export PATH="/opt/cursor-worker/.venv/bin:/opt/cursor-worker/.local/bin:${PATH}"

ENV_FILE="${CURSOR_ENV_FILE:-/etc/pragmatict/cursor.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
fi

WORK_DIR="${CURSOR_WORK_DIR:-/opt/cursor-worker/work}"
LOG_DIR="${CURSOR_LOG_DIR:-/opt/cursor-worker/logs}"
mkdir -p "$WORK_DIR" "$LOG_DIR"

PROMPT="${*:-}"
if [[ -z "$PROMPT" ]]; then
  echo "Usage: run-agent.sh \"your prompt\"" >&2
  exit 1
fi

if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "CURSOR_API_KEY is not set. Put it in $ENV_FILE" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="${LOG_DIR}/agent-${STAMP}.log"

echo "[$(date -u +%FT%TZ)] Starting headless agent" | tee -a "$LOG_FILE"
echo "Prompt: $PROMPT" | tee -a "$LOG_FILE"

cd "$WORK_DIR"
# --print = headless, --force = allow writes without prompts, --trust = trust workspace
set +e
/opt/cursor-worker/.local/bin/agent -p --force --trust \
  --output-format text \
  --workspace "$WORK_DIR" \
  "$PROMPT" 2>&1 | tee -a "$LOG_FILE"
STATUS=${PIPESTATUS[0]}
set -e

echo "[$(date -u +%FT%TZ)] Finished with status $STATUS" | tee -a "$LOG_FILE"
exit "$STATUS"
