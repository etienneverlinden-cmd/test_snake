#!/usr/bin/env python3
"""Deck Studio API — create Cursor worker jobs and serve results.

Listens on 127.0.0.1:8790. Auth: Convex JWT (Bearer) verified via users:viewer.

Job types:
  - draft: AI outline / slide text only (no .pptx)
  - generate: produce .pptx from approved draft (+ optional attachments)
"""
from __future__ import annotations

import base64
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
ATTACH_ROOT = Path(
    os.environ.get("CURSOR_ATTACHMENTS", "/opt/cursor-worker/attachments")
)
CONVEX_URL = os.environ.get(
    "CONVEX_URL", "https://limitless-duck-213.convex.cloud"
).rstrip("/")
HOST = os.environ.get("DECK_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("DECK_API_PORT", "8790"))

SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
SAFE_FILENAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,120}$")

MAX_ATTACHMENTS = 6
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024  # 8 MiB each
MAX_TOTAL_ATTACH_BYTES = 20 * 1024 * 1024  # 20 MiB total
ALLOWED_MIME_PREFIXES = ("image/",)
ALLOWED_MIME_EXACT = {
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
}
ALLOWED_EXT = {".pptx", ".ppt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


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
        and p.name
        not in {
            "request.json",
            "result.json",
            "summary.txt",
            "draft.md",
            "outline.md",
            "outline.txt",
            "draft.txt",
        }
        and not p.name.startswith(".")
        and p.suffix.lower() not in {".md", ".txt", ".json", ".log"}
    ]
    return candidates[0] if candidates else None


def find_draft_text(job_dir: Path) -> str | None:
    if not job_dir.is_dir():
        return None
    for name in ("draft.md", "outline.md", "outline.txt", "draft.txt"):
        path = job_dir / name
        if path.is_file():
            return path.read_text(encoding="utf-8", errors="replace")[:50000]
    return None


def job_status(job_id: str) -> dict:
    out = OUTBOX / job_id
    inbox_file = INBOX / f"{job_id}.json"
    processing = INBOX / f"{job_id}.processing"
    result = read_json(out / "result.json") if out.is_dir() else None
    request = read_json(out / "request.json") if out.is_dir() else None
    if request is None and inbox_file.is_file():
        request = read_json(inbox_file)
    if request is None and processing.is_file():
        request = read_json(processing)

    job_type = (request or {}).get("type") or "generate"
    download = find_download(out) if out.is_dir() else None
    draft = find_draft_text(out) if out.is_dir() else None
    summary = None
    summary_path = out / "summary.txt"
    if summary_path.is_file():
        summary = summary_path.read_text(encoding="utf-8", errors="replace")[:4000]

    base = {
        "id": job_id,
        "type": job_type,
        "summary": summary,
        "draft": draft,
        "downloadAvailable": bool(download) and job_type != "draft",
        "downloadName": download.name if download else None,
    }

    if result:
        status = result.get("status") or "done"
        if status == "ok":
            if job_type == "draft":
                status = "ready" if draft else "done"
            else:
                status = "ready" if download else "done"
        return {**base, "status": status, "result": result}
    if processing.exists():
        return {**base, "status": "running", "downloadAvailable": False}
    if inbox_file.exists():
        return {**base, "status": "queued", "downloadAvailable": False}
    if out.is_dir():
        if job_type == "draft" and draft:
            return {**base, "status": "ready"}
        return {
            **base,
            "status": "running",
            "downloadAvailable": bool(download) and job_type != "draft",
        }
    return {"id": job_id, "status": "not_found", "type": job_type}


def sanitize_filename(name: str, index: int) -> str:
    raw = (name or f"file-{index}").replace("\\", "/").split("/")[-1].strip()
    if not SAFE_FILENAME.match(raw):
        ext = Path(raw).suffix.lower() if "." in raw else ""
        if ext not in ALLOWED_EXT:
            ext = ""
        raw = f"attachment-{index}{ext}"
    return raw[:120]


def decode_attachments(raw_list, job_id: str) -> list[dict]:
    if not raw_list:
        return []
    if not isinstance(raw_list, list):
        raise ValueError("attachments must be an array")
    if len(raw_list) > MAX_ATTACHMENTS:
        raise ValueError(f"too many attachments (max {MAX_ATTACHMENTS})")

    attach_dir = ATTACH_ROOT / job_id
    attach_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict] = []
    total = 0

    for i, item in enumerate(raw_list):
        if not isinstance(item, dict):
            raise ValueError("each attachment must be an object")
        name = sanitize_filename(str(item.get("name") or ""), i)
        mime = str(item.get("mime") or item.get("type") or "application/octet-stream")
        ext = Path(name).suffix.lower()
        kind = str(item.get("kind") or "").lower()
        if not kind:
            if ext in {".pptx", ".ppt"} or mime in ALLOWED_MIME_EXACT:
                kind = "pptx"
            elif mime.startswith("image/") or ext in {
                ".png",
                ".jpg",
                ".jpeg",
                ".gif",
                ".webp",
                ".svg",
            }:
                kind = "image"
            else:
                kind = "file"

        if kind == "pptx":
            if ext not in {".pptx", ".ppt"} and mime not in ALLOWED_MIME_EXACT:
                raise ValueError(f"unsupported PowerPoint type: {name}")
        elif kind == "image":
            if not (
                mime.startswith(ALLOWED_MIME_PREFIXES)
                or ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
            ):
                raise ValueError(f"unsupported image type: {name}")
        else:
            raise ValueError(f"unsupported attachment kind for {name}")

        data_b64 = item.get("data") or item.get("content") or ""
        if not isinstance(data_b64, str) or not data_b64.strip():
            raise ValueError(f"missing data for attachment {name}")
        # Allow data-URL prefix
        if "," in data_b64 and data_b64.strip().lower().startswith("data:"):
            data_b64 = data_b64.split(",", 1)[1]
        try:
            raw = base64.b64decode(data_b64, validate=False)
        except Exception as exc:
            raise ValueError(f"invalid base64 for {name}") from exc
        if len(raw) > MAX_ATTACHMENT_BYTES:
            raise ValueError(f"{name} exceeds {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MiB")
        total += len(raw)
        if total > MAX_TOTAL_ATTACH_BYTES:
            raise ValueError("total attachments too large")

        dest = attach_dir / name
        # Avoid overwrite collisions
        if dest.exists():
            dest = attach_dir / f"{i}-{name}"
        dest.write_bytes(raw)
        os.chmod(dest, 0o640)
        saved.append(
            {
                "name": dest.name,
                "path": str(dest),
                "mime": mime,
                "kind": kind,
                "bytes": len(raw),
            }
        )
    return saved


def build_prompt(
    *,
    job_type: str,
    title: str,
    audience: str,
    slides: int,
    brief: str,
    prior_draft: str,
    refine_message: str,
    attachments: list[dict],
) -> str:
    attach_lines = []
    for a in attachments:
        attach_lines.append(
            f"- [{a['kind']}] {a['name']} at {a['path']} ({a['bytes']} bytes, {a['mime']})"
        )
    attach_block = (
        "\nReference attachments (read these files):\n" + "\n".join(attach_lines) + "\n"
        if attach_lines
        else "\nNo reference attachments.\n"
    )

    if job_type == "draft":
        refine_block = ""
        if prior_draft.strip():
            refine_block += (
                "\nPrevious draft to revise:\n"
                "----- BEGIN PRIOR DRAFT -----\n"
                f"{prior_draft.strip()}\n"
                "----- END PRIOR DRAFT -----\n"
            )
        if refine_message.strip():
            refine_block += (
                f"\nUser revision request:\n{refine_message.strip()}\n"
            )
        return (
            f"You are drafting slide outline/text for an executive PowerPoint for Pragmatict.\n"
            f"Do NOT create a .pptx file yet. Produce text only.\n"
            f"Title: {title}\n"
            f"Audience: {audience or 'executive stakeholders'}\n"
            f"Target slides: about {slides}\n"
            f"Language: English\n"
            f"Tone: corporate consulting, clear and concise.\n\n"
            f"Brief from the user:\n{brief}\n"
            f"{attach_block}"
            f"{refine_block}\n"
            f"Requirements:\n"
            f"- Write a clear slide-by-slide outline with titles and bullet points.\n"
            f"- Start with a short '# Style' section (theme colors, title treatment, layout notes) so formatting can be previewed and revised.\n"
            f"- Use headings like '## Slide 1: Title' then bullets; optionally lines 'Layout: title|content|section' and 'Image: filename'.\n"
            f"- If a reference .pptx is attached, mirror its structure/format where helpful and reflect that in Style.\n"
            f"- If images are attached, note which slide should use which image (by filename).\n"
            f"- Save the full draft as draft.md in the outbox folder given below.\n"
            f"- Also write a short summary.txt (2-4 sentences) describing the draft.\n"
        )

    # generate
    draft_block = ""
    if prior_draft.strip():
        draft_block = (
            "\nApproved slide draft (follow this content closely):\n"
            "----- BEGIN APPROVED DRAFT -----\n"
            f"{prior_draft.strip()}\n"
            "----- END APPROVED DRAFT -----\n"
        )
    if refine_message.strip():
        draft_block += f"\nAdditional user notes for generation:\n{refine_message.strip()}\n"

    return (
        f"You are creating an executive PowerPoint for Pragmatict.\n"
        f"Title: {title}\n"
        f"Audience: {audience or 'executive stakeholders'}\n"
        f"Target slides: about {slides}\n"
        f"Language: English\n"
        f"Tone: corporate consulting, clear and concise.\n\n"
        f"Brief from the user:\n{brief}\n"
        f"{attach_block}"
        f"{draft_block}\n"
        f"Requirements:\n"
        f"- Create a real .pptx file (use python-pptx; available on PATH).\n"
        f"- Follow the approved draft content; do not invent a different structure unless needed for PPTX.\n"
        f"- If a reference .pptx is attached, use it as a format/style reference when practical.\n"
        f"- If images are attached, include them on the slides indicated in the draft.\n"
        f"- Save the .pptx and a short summary.txt into the outbox folder given below.\n"
        f"- Also copy/save the final slide text as draft.md alongside the pptx for continuity.\n"
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "DeckAPI/1.1"

    def log_message(self, fmt, *args):
        print(f"[deck-api] {self.address_string()} {fmt % args}")

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if (
            origin.endswith("pragmatict.be")
            or origin.startswith("http://localhost")
            or origin.startswith("http://127.0.0.1")
        ):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header(
                "Access-Control-Allow-Headers", "Authorization, Content-Type"
            )
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
        viewer = convex_viewer(token)
        if not viewer:
            return None
        # Membership gate (same as site auth-guard)
        if viewer.get("accessStatus") != "approved":
            return None
        return viewer

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
        # Cap request body (~28 MiB) to leave headroom for JSON wrapping
        if length > 28 * 1024 * 1024:
            return self._json(413, {"error": "request too large"})
        try:
            body = json.loads(self.rfile.read(length).decode() if length else "{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "invalid json"})

        job_type = str(body.get("type") or "generate").strip().lower()
        if job_type not in {"draft", "generate"}:
            return self._json(400, {"error": "type must be draft or generate"})

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

        prior_draft = str(body.get("priorDraft") or body.get("draft") or "").strip()
        refine_message = str(
            body.get("refineMessage") or body.get("message") or ""
        ).strip()[:8000]

        if job_type == "generate" and len(prior_draft) < 40:
            return self._json(
                400,
                {
                    "error": "approved draft required before generating PowerPoint (priorDraft)"
                },
            )

        job_id = f"deck-{uuid.uuid4().hex[:12]}"
        try:
            attachments = decode_attachments(body.get("attachments") or [], job_id)
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})

        prompt = build_prompt(
            job_type=job_type,
            title=title,
            audience=audience,
            slides=slides,
            brief=brief,
            prior_draft=prior_draft,
            refine_message=refine_message,
            attachments=attachments,
        )

        job = {
            "id": job_id,
            "type": job_type,
            "title": title,
            "audience": audience,
            "slides": slides,
            "brief": brief,
            "priorDraft": prior_draft[:50000] if prior_draft else "",
            "refineMessage": refine_message,
            "attachments": [
                {k: a[k] for k in ("name", "path", "mime", "kind", "bytes")}
                for a in attachments
            ],
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
        return self._json(
            201, {"id": job_id, "status": "queued", "type": job_type}
        )

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        parts = [p for p in path.strip("/").split("/") if p]
        # /api/deck/jobs/:id[/download]
        if (
            len(parts) < 3
            or parts[0] != "api"
            or parts[1] != "deck"
            or parts[2] != "jobs"
        ):
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
            st = job_status(job_id)
            if st.get("type") == "draft":
                return self._json(400, {"error": "draft jobs have no pptx download"})
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
    ATTACH_ROOT.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[deck-api] listening on {HOST}:{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
