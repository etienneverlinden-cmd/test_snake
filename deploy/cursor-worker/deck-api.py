#!/usr/bin/env python3
"""Deck Studio API — create Cursor worker jobs and serve results.

Listens on 127.0.0.1:8790. Auth: Convex JWT (Bearer) verified via users:viewer.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

INBOX = Path(os.environ.get("CURSOR_INBOX", "/opt/cursor-worker/inbox"))
OUTBOX = Path(os.environ.get("CURSOR_OUTBOX", "/opt/cursor-worker/outbox"))
CONVEX_URL = os.environ.get(
    "CONVEX_URL", "https://limitless-duck-213.convex.cloud"
).rstrip("/")
HOST = os.environ.get("DECK_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("DECK_API_PORT", "8790"))

SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


def convex_viewer(token: str) -> dict | None:
    body = json.dumps(
        {"path": "users:viewer", "args": {}, "format": "json"}
    ).encode()
    req = Request(
        f"{CONVEX_URL}/api/query",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return None
    if isinstance(data, dict) and "value" in data:
        return data["value"]
    if isinstance(data, dict) and data.get("status") == "success":
        return data.get("value")
    return data if isinstance(data, dict) else None


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def find_download(job_dir: Path) -> Path | None:
    if not job_dir.is_dir():
        return None
    pptx = sorted(job_dir.glob("*.pptx"))
    if pptx:
        return pptx[0]
    candidates = [
        p
        for p in job_dir.iterdir()
        if p.is_file()
        and p.name not in {"request.json", "result.json", "summary.txt"}
        and not p.name.startswith(".")
    ]
    return candidates[0] if candidates else None


def job_status(job_id: str) -> dict:
    out = OUTBOX / job_id
    inbox_file = INBOX / f"{job_id}.json"
    processing = INBOX / f"{job_id}.processing"
    result = read_json(out / "result.json") if out.is_dir() else None
    download = find_download(out) if out.is_dir() else None
    summary = None
    summary_path = out / "summary.txt"
    if summary_path.is_file():
        summary = summary_path.read_text(encoding="utf-8", errors="replace")[:4000]

    if result:
        status = result.get("status") or "done"
        if status == "ok":
            status = "ready" if download else "done"
        return {
            "id": job_id,
            "status": status,
            "result": result,
            "summary": summary,
            "downloadAvailable": bool(download),
            "downloadName": download.name if download else None,
        }
    if processing.exists():
        return {"id": job_id, "status": "running", "downloadAvailable": False}
    if inbox_file.exists():
        return {"id": job_id, "status": "queued", "downloadAvailable": False}
    if out.is_dir():
        return {
            "id": job_id,
            "status": "running",
            "summary": summary,
            "downloadAvailable": bool(download),
            "downloadName": download.name if download else None,
        }
    return {"id": job_id, "status": "not_found"}


class Handler(BaseHTTPRequestHandler):
    server_version = "DeckAPI/1.0"

    def log_message(self, fmt, *args):
        print(f"[deck-api] {self.address_string()} {fmt % args}")

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin.endswith("pragmatict.be") or origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, code: int, payload: dict):
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _auth(self) -> dict | None:
        auth = self.headers.get("Authorization", "")
        if not auth.lower().startswith("bearer "):
            return None
        token = auth[7:].strip()
        if not token:
            return None
        return convex_viewer(token)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") != "/api/deck/jobs":
            return self._json(404, {"error": "not found"})
        user = self._auth()
        if not user:
            return self._json(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode() if length else "{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "invalid json"})

        title = str(body.get("title") or "Untitled deck").strip()[:120]
        audience = str(body.get("audience") or "").strip()[:200]
        slides = body.get("slides") or 8
        try:
            slides = max(3, min(20, int(slides)))
        except (TypeError, ValueError):
            slides = 8
        brief = str(body.get("brief") or body.get("prompt") or "").strip()
        if len(brief) < 20:
            return self._json(400, {"error": "brief too short (min 20 characters)"})

        job_id = f"deck-{uuid.uuid4().hex[:12]}"
        prompt = (
            f"You are creating an executive PowerPoint for Pragmatict.\n"
            f"Title: {title}\n"
            f"Audience: {audience or 'executive stakeholders'}\n"
            f"Target slides: about {slides}\n"
            f"Language: English\n"
            f"Tone: corporate consulting, clear and concise.\n\n"
            f"Brief from the user:\n{brief}\n\n"
            f"Requirements:\n"
            f"- Create a real .pptx file (use python-pptx or similar available tools).\n"
            f"- Professional structure: title, context, recommendations, next steps.\n"
            f"- Save the .pptx and a short summary.txt into the outbox folder given below.\n"
        )
        job = {
            "id": job_id,
            "title": title,
            "audience": audience,
            "slides": slides,
            "brief": brief,
            "prompt": prompt,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "createdBy": {
                "id": user.get("id"),
                "email": user.get("email"),
                "name": user.get("name"),
            },
        }
        INBOX.mkdir(parents=True, exist_ok=True)
        path = INBOX / f"{job_id}.json"
        path.write_text(json.dumps(job, indent=2), encoding="utf-8")
        os.chmod(path, 0o640)
        return self._json(201, {"id": job_id, "status": "queued"})

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        parts = [p for p in path.strip("/").split("/") if p]
        # /api/deck/jobs/:id[/download]
        if len(parts) < 3 or parts[0] != "api" or parts[1] != "deck" or parts[2] != "jobs":
            return self._json(404, {"error": "not found"})
        if len(parts) == 3:
            return self._json(400, {"error": "job id required"})
        job_id = parts[3]
        if not SAFE_ID.match(job_id):
            return self._json(400, {"error": "invalid job id"})
        user = self._auth()
        if not user:
            return self._json(401, {"error": "unauthorized"})

        if len(parts) == 4:
            return self._json(200, job_status(job_id))

        if len(parts) == 5 and parts[4] == "download":
            download = find_download(OUTBOX / job_id)
            if not download:
                return self._json(404, {"error": "file not ready"})
            data = download.read_bytes()
            self.send_response(200)
            ctype = (
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                if download.suffix.lower() == ".pptx"
                else "application/octet-stream"
            )
            self.send_header("Content-Type", ctype)
            self.send_header(
                "Content-Disposition", f'attachment; filename="{download.name}"'
            )
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return

        return self._json(404, {"error": "not found"})


def main():
    INBOX.mkdir(parents=True, exist_ok=True)
    OUTBOX.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[deck-api] listening on {HOST}:{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
