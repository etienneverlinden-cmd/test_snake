#!/usr/bin/env bash
# One-shot installer for Snake auto-deploy on the VPS.
# Run as root after files are in /opt/snake/deploy/
set -euo pipefail

id snakedeploy >/dev/null 2>&1 || useradd --system --home /opt/snake --shell /usr/sbin/nologin snakedeploy
mkdir -p /opt/snake/deploy /opt/snake/repo /run/snake-deploy /etc/snake /var/www/snake
chown root:snakedeploy /run/snake-deploy
chmod 775 /run/snake-deploy

if [ ! -f /etc/snake/webhook.env ]; then
  SECRET=$(openssl rand -hex 32)
  cat > /etc/snake/webhook.env << EOF
SNAKE_WEBHOOK_SECRET=${SECRET}
SNAKE_DEPLOY_BRANCH=main
SNAKE_WEBHOOK_PORT=8788
SNAKE_DEPLOY_FLAG=/run/snake-deploy/request
EOF
  echo "Created /etc/snake/webhook.env"
else
  echo "Keeping existing /etc/snake/webhook.env"
fi
chmod 640 /etc/snake/webhook.env
chown root:snakedeploy /etc/snake/webhook.env

chmod +x /opt/snake/deploy/auto-deploy.sh /opt/snake/deploy/install-on-server.sh

if [ ! -d /opt/snake/repo/.git ]; then
  git clone --depth 1 https://github.com/etienneverlinden-cmd/test_snake.git /opt/snake/repo
fi

install -m 0644 /opt/snake/deploy/systemd/snake-webhook.service /etc/systemd/system/
install -m 0644 /opt/snake/deploy/systemd/snake-deploy.path /etc/systemd/system/
install -m 0644 /opt/snake/deploy/systemd/snake-deploy.service /etc/systemd/system/

# Ensure Caddy snake site proxies the webhook path
if ! grep -q '_snake_deploy' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.snake-deploy
  # Replace the simple snake IP block with one that includes the webhook
  python3 - <<'PY'
from pathlib import Path
path = Path("/etc/caddy/Caddyfile")
text = path.read_text()
old = """# Serpent snake game — public static site on the server IP (does not touch HQ)
http://89.167.46.13 {
	root * /var/www/snake
	encode gzip
	file_server
}"""
new = """# Serpent snake game — public static site on the server IP (does not touch HQ)
http://89.167.46.13 {
	handle /_snake_deploy {
		reverse_proxy 127.0.0.1:8788
	}
	handle {
		root * /var/www/snake
		encode gzip
		file_server
	}
}"""
if old in text:
    path.write_text(text.replace(old, new))
    print("Caddyfile updated")
elif "_snake_deploy" in text:
    print("Caddyfile already has snake webhook")
else:
    path.write_text(text.rstrip() + "\n\n" + new + "\n")
    print("Caddyfile appended")
PY
fi

set -a
# shellcheck disable=SC1091
. /etc/hq/caddy.env
set +a
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy

systemctl daemon-reload
systemctl enable --now snake-webhook.service snake-deploy.path
systemctl restart snake-webhook.service

# Initial publish
/opt/snake/deploy/auto-deploy.sh

echo
echo "=== Snake auto-deploy installed ==="
echo "Webhook URL:  http://89.167.46.13/_snake_deploy"
echo "Secret:"
grep SNAKE_WEBHOOK_SECRET /etc/snake/webhook.env
echo
systemctl is-active snake-webhook.service snake-deploy.path
