#!/usr/bin/env python3
import argparse,hashlib,json,subprocess,sys,zipfile,shutil
from pathlib import Path
from datetime import datetime,timezone
repo=Path(__file__).resolve().parents[3]
pkg=Path(__file__).resolve().parent
manifest=json.loads((pkg/'manifest.json').read_text())
p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True)
g.add_argument('--check',action='store_true');g.add_argument('--apply',action='store_true');a=p.parse_args()
sha=lambda b:hashlib.sha256(b).hexdigest()
for rel,spec in manifest['files'].items():
 target=repo/rel;patch=pkg/'patched'/rel
 if not target.is_file() or sha(target.read_bytes())!=spec['before_sha256']:
  raise SystemExit('SAFE STOP: original source SHA mismatch: '+rel)
 if not patch.is_file() or sha(patch.read_bytes())!=spec['after_sha256']:
  raise SystemExit('SAFE STOP: payload SHA mismatch: '+rel)
 result=subprocess.run(['node','--input-type=module','--check'],input=patch.read_bytes(),capture_output=True)
 if result.returncode: raise SystemExit('SAFE STOP: ESM syntax error: '+result.stderr.decode())
print('R2.2 PHASE B1 SHA + ESM GATE: PASS')
if a.check:
 print('SAFE STOP: no changes; no Luna / DB / deploy');sys.exit(0)
folder=Path.home()/'Downloads'
if not folder.is_dir():raise SystemExit('Downloads folder missing')
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=folder/f'PRIMA_R22_PHASE_B1_BACKUP_{stamp}.zip'
with zipfile.ZipFile(backup,'x',zipfile.ZIP_DEFLATED) as z:
 for rel in manifest['files']:z.write(repo/rel,rel)
 z.writestr('MANIFEST.json',json.dumps(manifest,indent=2))
with zipfile.ZipFile(backup) as z:
 if z.testzip() is not None:raise SystemExit('BACKUP CHECK FAILED')
try:
 for rel in manifest['files']:
  shutil.copy2(pkg/'patched'/rel,repo/rel)
 subprocess.run(['node',str(pkg/'tests.mjs')],cwd=repo,check=True)
 for rel,spec in manifest['files'].items():
  if sha((repo/rel).read_bytes())!=spec['after_sha256']:
   raise RuntimeError('POST INSTALL SHA ERROR: '+rel)
except Exception as err:
 with zipfile.ZipFile(backup) as z:
  for rel in manifest['files']:(repo/rel).write_bytes(z.read(rel))
 raise SystemExit('AUTO ROLLBACK: '+repr(err))
print('R2.2 PHASE B1 LOCAL APPLY: PASS')
print('BACKUP:',backup)
print('DEPLOYS 0; LUNA 0; DB WRITES 0')
print('NOTE: comparison content + cards assembly not implemented in Phase B1')
