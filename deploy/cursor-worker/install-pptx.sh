#!/bin/bash
set -euo pipefail
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-pip python3-venv
sudo -u cursor-worker python3 -m venv /opt/cursor-worker/.venv
sudo -u cursor-worker /opt/cursor-worker/.venv/bin/pip install -q python-pptx
sudo -u cursor-worker /opt/cursor-worker/.venv/bin/python -c 'import pptx; print(pptx.__version__)'

# Prefer venv python for agent shell tools
if ! grep -q 'cursor-worker/.venv' /opt/cursor-worker/bin/worker.sh 2>/dev/null; then
  sed -i 's|export PATH="/opt/cursor-worker/.local/bin:${PATH}"|export PATH="/opt/cursor-worker/.venv/bin:/opt/cursor-worker/.local/bin:${PATH}"|' /opt/cursor-worker/bin/worker.sh || true
fi
if ! grep -q 'cursor-worker/.venv' /opt/cursor-worker/bin/run-agent.sh 2>/dev/null; then
  sed -i 's|export PATH="/opt/cursor-worker/.local/bin:${PATH}"|export PATH="/opt/cursor-worker/.venv/bin:/opt/cursor-worker/.local/bin:${PATH}"|' /opt/cursor-worker/bin/run-agent.sh || true
fi

# Update systemd PATH for cursor-worker
sed -i 's|Environment=PATH=.*|Environment=PATH=/opt/cursor-worker/.venv/bin:/opt/cursor-worker/.local/bin:/usr/local/bin:/usr/bin:/bin|' /etc/systemd/system/cursor-worker.service
systemctl daemon-reload
systemctl restart cursor-worker
systemctl is-active cursor-worker deck-api
echo "PPTX_READY"
