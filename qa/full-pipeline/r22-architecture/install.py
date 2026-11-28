#!/usr/bin/env python3
"""SHA-gated, reversible offline installation of PRIMA R2.2 phase A."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
pkg = Path(__file__).resolve().parent
manifest = json.loads((pkg / 'manifest.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
mode = parser.add_mutually_exclusive_group(required=True)
mode.add_argument('--check', action='store_true')
mode.add_argument('--apply', action='store_true')
args = parser.parse_args()

def sha(data):
    return hashlib.sha256(data).hexdigest()

files = []
for rel, spec in manifest['files'].items():
    target = repo / rel
    patched = pkg / 'patched' / rel
    if not patched.is_file():
        raise SystemExit('PACKAGE FILE MISSING: ' + rel)
    if sha(patched.read_bytes()) != spec['after_sha256']:
        raise SystemExit('PACKAGE SHA MISMATCH: ' + rel)
    before = spec['before_sha256']
    if before is None:
        if target.exists():
            raise SystemExit('SAFE STOP: NEW MODULE ALREADY EXISTS: ' + rel)
    else:
        if not target.is_file():
            raise SystemExit('SAFE STOP: SOURCE MISSING: ' + rel)
        current = sha(target.read_bytes())
        if current != before:
            raise SystemExit(f'SAFE STOP: SOURCE SHA MISMATCH: {rel} {current} != {before}')
    files.append((rel, patched, target, before))

print('PRIMA R2.2 PHASE A SOURCE SHA GATE: PASS', len(files), 'files')
if args.check:
    print('SAFE STOP: no source changes, no Luna, no Supabase, no deploy')
    sys.exit(0)

stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
downloads = Path.home() / 'Downloads'
if not downloads.is_dir():
    raise SystemExit('SAFE STOP: Downloads folder missing')
backup = downloads / f'PRIMA_R22_PHASE_A_SOURCE_BACKUP_{stamp}.zip'
with zipfile.ZipFile(backup, 'x', zipfile.ZIP_DEFLATED) as z:
    for rel, _, target, before in files:
        if before is not None:
            z.write(target, rel)
    z.writestr('SHA_MANIFEST.json', json.dumps(manifest, indent=2))
with zipfile.ZipFile(backup) as z:
    if z.testzip() is not None:
        raise SystemExit('SAFE STOP: BACKUP INTEGRITY FAILED')

# Validate all payload JS syntax before touching any existing source.
for rel, patched, _, _ in files:
    result = subprocess.run(
        ['node', '--input-type=module', '--check'], cwd=repo,
        input=patched.read_bytes(), capture_output=True)
    if result.returncode != 0:
        raise SystemExit('SAFE STOP: PRE-INSTALL ESM SYNTAX FAIL: ' + rel + '\n'
                         + result.stderr.decode('utf-8', errors='replace'))
print('R2.2 PATCHED ESM SYNTAX PREFLIGHT: PASS', len(files), 'files')

try:
    for rel, patched, target, _ in files:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(patched, target)
    for rel, _, target, _ in files:
        # Wrangler bundles ESM source even though the repo package.json is CommonJS.
        # Check source as ESM regardless of Node's package-level module setting.
        result = subprocess.run(
            ['node', '--input-type=module', '--check'], cwd=repo,
            input=target.read_bytes(), capture_output=True)
        if result.returncode != 0:
            details = result.stderr.decode('utf-8', errors='replace')
            raise RuntimeError(f'ESM syntax check failed for {rel}:\n{details}')
        if sha(target.read_bytes()) != manifest['files'][rel]['after_sha256']:
            raise RuntimeError('post-install SHA mismatch: ' + rel)
    subprocess.run(['node', str(pkg / 'tests.mjs')], cwd=repo,
                   check=True)
except Exception as exc:
    with zipfile.ZipFile(backup) as z:
        for rel, _, target, before in files:
            if before is None:
                target.unlink(missing_ok=True)
            else:
                target.write_bytes(z.read(rel))
    raise SystemExit('R2.2 AUTOMATIC ROLLBACK: ' + repr(exc))
print('PRIMA R2.2 PHASE A LOCAL APPLY: PASS')
print('BACKUP:', backup)
print('PRODUCTION DEPLOYS: 0; LUNA CALLS: 0; LIVE DB: 0')
print('COMPARE+SEARCH INITIAL ONLY: comparison card continuation NOT YET VERIFIED')
