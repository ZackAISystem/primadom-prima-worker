#!/usr/bin/env python3
import argparse,hashlib,json,shutil,subprocess,sys
from pathlib import Path
from datetime import datetime,timezone
repo=Path(__file__).resolve().parents[3]
pkg=Path(__file__).resolve().parent
manifest=json.loads((pkg/'manifest.json').read_text())
parser=argparse.ArgumentParser()
parser.add_argument('--check',action='store_true')
parser.add_argument('--apply',action='store_true')
args=parser.parse_args()
if args.check == args.apply: parser.error('Select exactly one of --check or --apply')
def sha(b):return hashlib.sha256(b).hexdigest()
files=[]
for rel, hashes in manifest['files'].items():
    dst=repo/rel; src=pkg/'patched'/rel
    if not dst.is_file() or not src.is_file(): sys.exit('MISSING FILE: '+rel)
    current=sha(dst.read_bytes()); expected=hashes['before_sha256']
    if current != expected: sys.exit('SAFE STOP: SHA MISMATCH '+rel+' current='+current+' expected='+expected)
    if sha(src.read_bytes()) != hashes['after_sha256']: sys.exit('PACKAGE INTEGRITY FAIL '+rel)
    files.append((rel,src,dst))
print('R2.1 SHA PREFLIGHT PASS:',len(files),'files')
# no mutations until source verified
if args.check:
    print('SAFE STOP: No files changed. --apply required.');sys.exit(0)
backup=pkg/'backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
try:
    for rel,src,dst in files:
        b=backup/rel;b.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dst,b)
    for rel,src,dst in files:shutil.copy2(src,dst)
    for rel,src,dst in files:
        if rel.endswith('.py'):
            subprocess.run([sys.executable,'-m','py_compile',str(dst)],cwd=repo,check=True)
        else:
            subprocess.run(['node','--input-type=module','--check'],cwd=repo,
                           input=dst.read_bytes(),check=True)
    subprocess.run(['node',str(pkg/'tests.mjs')],cwd=repo,check=True)
except Exception as exc:
    for rel,src,dst in files:
        b=backup/rel
        if b.is_file():shutil.copy2(b,dst)
    sys.exit('R2.1 ROLLBACK: '+repr(exc))
print('R2.1 LOCAL APPLY PASS; BACKUP:',backup)
print('PRODUCTION DEPLOYS 0; LIVE DB 0; LUNA CALLS 0')
