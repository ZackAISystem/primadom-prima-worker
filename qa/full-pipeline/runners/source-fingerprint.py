#!/usr/bin/env python3
from pathlib import Path
import hashlib
import json
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
src = root / "src"

files = sorted(
    p for p in src.rglob("*")
    if p.is_file() and p.suffix in {".js", ".mjs", ".json"}
    and ".bak" not in p.name
    and ".backup" not in p.name
    and not p.name.startswith(".")
)

manifest = []
digest = hashlib.sha256()

for path in files:
    relative = path.relative_to(root).as_posix()
    content = path.read_bytes()
    sha = hashlib.sha256(content).hexdigest()

    manifest.append({"file": relative, "sha256": sha})
    digest.update(relative.encode("utf-8"))
    digest.update(b"\\0")
    digest.update(bytes.fromhex(sha))

def git(*args):
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        text=True,
        capture_output=True
    )
    return result.stdout.strip() if result.returncode == 0 else None

result = {
    "contract": "PRIMA_LIVE_SOURCE_ALWAYS_V1",
    "source_mode": "CURRENT_WORKTREE",
    "source_count": len(files),
    "source_sha256": digest.hexdigest(),
    "git_commit": git("rev-parse", "HEAD"),
    "git_branch": git("branch", "--show-current"),
    "git_worktree_changes": git("status", "--porcelain", "--", "src"),
    "files": manifest
}

if "--full" not in sys.argv:
    result.pop("files")

print(json.dumps(result, ensure_ascii=False, indent=2))
