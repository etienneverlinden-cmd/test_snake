"""Snake deploy webhook — receives GitHub push events.

GitHub POSTs here when main moves. This process is deliberately powerless: it
runs as an unprivileged user, and the only thing it can do is touch a file.
A systemd .path unit watches that file and runs the actual deploy as root.

Listens on 127.0.0.1 only — Caddy is the only way in.
"""
import hashlib
import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SECRET = os.environ.get("SNAKE_WEBHOOK_SECRET", "").encode()
PORT = int(os.environ.get("SNAKE_WEBHOOK_PORT", "8788"))
BRANCH = "refs/heads/" + os.environ.get("SNAKE_DEPLOY_BRANCH", "main")
FLAG = Path(os.environ.get("SNAKE_DEPLOY_FLAG", "/run/snake-deploy/request"))
MAX_BODY = 1 << 20

if len(SECRET) < 32:
    sys.exit(
        "SNAKE_WEBHOOK_SECRET must be set and at least 32 characters "
        "(generate: openssl rand -hex 32)"
    )


def log(msg: str) -> None:
    print(f"snake-webhook: {msg}", flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "snake-deploy"
    sys_version = ""

    def _reply(self, code: int, text: str = "") -> None:
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.rstrip("/") != "/_snake_deploy":
            return self._reply(404, "no")

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            self.close_connection = True
            return self._reply(400, "bad length")
        body = self.rfile.read(length)

        want = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
        got = self.headers.get("X-Hub-Signature-256", "")
        if not hmac.compare_digest(want, got):
            log(f"rejected: bad signature from {self.client_address[0]}")
            return self._reply(401, "bad signature")

        event = self.headers.get("X-GitHub-Event", "")
        if event == "ping":
            log("ping ok")
            return self._reply(204)
        if event != "push":
            return self._reply(204)

        try:
            ref = json.loads(body).get("ref", "")
        except (ValueError, AttributeError):
            return self._reply(400, "bad json")
        if ref != BRANCH:
            log(f"ignoring push to {ref}")
            return self._reply(204)

        try:
            FLAG.parent.mkdir(parents=True, exist_ok=True)
            FLAG.touch()
        except OSError as e:
            log(f"could not request deploy: {e}")
            return self._reply(500, "cannot queue")
        log(f"deploy requested for {ref}")
        self._reply(202, "queued")

    def do_GET(self):
        self._reply(404, "no")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    log(f"listening on 127.0.0.1:{PORT}, deploying on {BRANCH}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
