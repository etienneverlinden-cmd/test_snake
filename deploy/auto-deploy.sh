#!/usr/bin/env bash
# Pull origin/main and publish static files to /var/www/snake.
# Triggered by snake-deploy.path when deploy/webhook.py touches the flag file.
# Safe to run by hand:  sudo /opt/snake/deploy/auto-deploy.sh
#
# Does NOT touch HQ, Caddy HQ config, or /opt/hq.
set -uo pipefail

REPO_DIR="${SNAKE_REPO_DIR:-/opt/snake/repo}"
WEB_DIR="${SNAKE_WEB_DIR:-/var/www/snake}"
BRANCH="${SNAKE_DEPLOY_BRANCH:-main}"
FLAG="${SNAKE_DEPLOY_FLAG:-/run/snake-deploy/request}"
LOCK="${SNAKE_DEPLOY_LOCK:-/run/snake-deploy.lock}"

rm -f "$FLAG"

exec 9>"$LOCK"
flock -n 9 || { echo "snake-deploy: another deploy is running, skipping"; exit 0; }

cd "$REPO_DIR" || { echo "snake-deploy: $REPO_DIR missing"; exit 1; }

OLD=$(git rev-parse HEAD)
git fetch --quiet origin "$BRANCH" || { echo "snake-deploy: fetch failed"; exit 1; }
NEW=$(git rev-parse "origin/$BRANCH")

if [ "$OLD" = "$NEW" ]; then
	echo "snake-deploy: already on $NEW, nothing to do"
	# Still sync files in case someone edited /var/www/snake by hand
else
	echo "snake-deploy: $OLD → $NEW"
	git reset --quiet --hard "$NEW" || { echo "snake-deploy: reset failed"; exit 1; }
fi

# Publish only site assets — never .git or deploy tooling into the web root
mkdir -p "$WEB_DIR/assets"
rsync -a --delete \
	--exclude '.git/' \
	--exclude 'deploy/' \
	--exclude 'node_modules/' \
	--exclude 'convex/' \
	--exclude '.convex/' \
	--exclude 'package.json' \
	--exclude 'package-lock.json' \
	--exclude '.gitignore' \
	--exclude '.env' \
	--exclude '.env.example' \
	--exclude 'CONVEX.md' \
	--exclude 'README.md' \
	"$REPO_DIR/" "$WEB_DIR/"

chown -R root:root "$WEB_DIR"
find "$WEB_DIR" -type d -exec chmod 755 {} \;
find "$WEB_DIR" -type f -exec chmod 644 {} \;

echo "snake-deploy: OK — now on $(git rev-parse --short HEAD) ($(git log -1 --pretty=%s))"
exit 0
