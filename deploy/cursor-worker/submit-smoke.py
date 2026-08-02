#!/usr/bin/env python3
import json
import time
from pathlib import Path

inbox = Path("/opt/cursor-worker/inbox")
outbox = Path("/opt/cursor-worker/outbox")

# Clean stuck bad smoke job
for p in inbox.glob("smoke-*.processing"):
    job_id = p.name.replace(".processing", "")
    dest = outbox / job_id
    dest.mkdir(parents=True, exist_ok=True)
    p.rename(dest / "request.json")
    (dest / "result.json").write_text(
        '{"status":"error","error":"invalid json (cleanup)"}', encoding="utf-8"
    )
    print(f"cleaned {p}")

job_id = f"smoke-{int(time.time())}"
out = outbox / job_id
out.mkdir(parents=True, exist_ok=True)
job = {
    "id": job_id,
    "prompt": (
        "Create a 3-slide PowerPoint about fibre programme governance. "
        "Use python-pptx (already installed). "
        f"Save the file as {out}/deck.pptx and write {out}/summary.txt. "
        "Keep content short and professional."
    ),
    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
path = inbox / f"{job_id}.json"
path.write_text(json.dumps(job), encoding="utf-8")
print(f"JOB={job_id}")
