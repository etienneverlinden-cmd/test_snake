# Headless Cursor worker (Hetzner)

Installed under `/opt/cursor-worker` as user `cursor-worker`.

## One-time auth

1. Create an API key: https://cursor.com/dashboard/api
2. On the server:

```bash
nano /etc/pragmatict/cursor.env
# set: CURSOR_API_KEY=...
chmod 600 /etc/pragmatict/cursor.env
chown root:cursor-worker /etc/pragmatict/cursor.env
systemctl enable --now cursor-worker
```

## Manual test

```bash
sudo -u cursor-worker -H \
  bash -lc 'source /etc/pragmatict/cursor.env; /opt/cursor-worker/bin/run-agent.sh "Reply with: hello from headless cursor"'
```

## Deck Studio job types

`POST /api/deck/jobs` (via Caddy → `deck-api.py`) accepts:

| Field | Notes |
| --- | --- |
| `type` | `draft` (outline text only) or `generate` (`.pptx`) |
| `title`, `audience`, `slides`, `brief` | Same as before |
| `priorDraft` | Required for `generate`; used for refine iterations |
| `refineMessage` | Optional chat instruction for the next draft |
| `attachments` | Optional array of `{ name, mime, kind, data }` where `data` is base64; `kind` is `pptx` or `image` |

Flow expected by the UI (`deck-studio.html`):

1. User fills brief + optional reference `.pptx` + optional images → **Draft outline** (`type: draft`).
2. Review `draft.md` text; chat refine → more `draft` jobs with `priorDraft` + `refineMessage`.
3. Explicit **Generate PowerPoint** → `type: generate` with approved `priorDraft`.
4. After download → **Want changes?** returns to review; regenerate only on approve.

Draft jobs write `outbox/<id>/draft.md` (+ `summary.txt`). Generate jobs write `.pptx`, `draft.md`, and `summary.txt`. Attachments are stored under `/opt/cursor-worker/attachments/<job-id>/` and staged into the outbox for the agent.

## Queue a deck job (manual)

```bash
cat >/opt/cursor-worker/inbox/deck-demo.json <<'EOF'
{
  "id": "deck-demo",
  "type": "generate",
  "prompt": "Create a 5-slide executive PowerPoint about fibre programme governance and cost control. Save the .pptx under the outbox folder given in the instructions."
}
EOF
```

Results appear in `/opt/cursor-worker/outbox/deck-demo/`.

## python-pptx

The agent needs `python-pptx` to build real `.pptx` files. Install once:

```bash
bash /opt/cursor-worker/bin/install-pptx.sh
# or: sudo -u cursor-worker python3 -m venv /opt/cursor-worker/.venv
#     sudo -u cursor-worker /opt/cursor-worker/.venv/bin/pip install python-pptx
```

`worker.sh` and `cursor-worker.service` put `/opt/cursor-worker/.venv/bin` first on `PATH`.

## VPS apply (Deck Studio iterate — do not push `main` casually)

Static UI ships with the site deploy from git. API/worker live under `/opt/cursor-worker` and must be copied separately:

```bash
# On the VPS, from a checkout of feature/deck-studio-iterate (or scp the files):
sudo install -o cursor-worker -g cursor-worker -m 755 \
  deploy/cursor-worker/worker.sh /opt/cursor-worker/bin/worker.sh
sudo install -o cursor-worker -g cursor-worker -m 644 \
  deploy/cursor-worker/deck-api.py /opt/cursor-worker/bin/deck-api.py
sudo install -o root -g root -m 644 \
  deploy/cursor-worker/deck-api.service /etc/systemd/system/deck-api.service
sudo install -o root -g root -m 644 \
  deploy/cursor-worker/cursor-worker.service /etc/systemd/system/cursor-worker.service

sudo mkdir -p /opt/cursor-worker/attachments
sudo chown cursor-worker:cursor-worker /opt/cursor-worker/attachments

sudo systemctl daemon-reload
sudo systemctl restart deck-api cursor-worker
sudo systemctl status deck-api cursor-worker --no-pager
```

Smoke-check after deploy:

```bash
curl -sS http://127.0.0.1:8790/api/deck/jobs | head
# expect JSON unauthorized/not found — proves the API process is up
```

## Local UI test

```bash
# From the repo root (feature branch):
python -m http.server 8080
# Open http://127.0.0.1:8080/deck-studio.html (sign-in still hits Convex).
# /api/deck/* only works when pointed at the VPS (or a local deck-api + worker).
```

To exercise the full loop without shipping `main`, deploy the static files from this feature branch to a non-production path, or temporarily serve them locally while the VPS API already has the updated `deck-api.py` / `worker.sh`.
