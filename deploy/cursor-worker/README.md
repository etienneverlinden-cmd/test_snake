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

## Queue a deck job

```bash
cat >/opt/cursor-worker/inbox/deck-demo.json <<'EOF'
{
  "id": "deck-demo",
  "prompt": "Create a 5-slide executive PowerPoint about fibre programme governance and cost control. Save the .pptx under the outbox folder given in the instructions."
}
EOF
```

Results appear in `/opt/cursor-worker/outbox/deck-demo/`.
