#!/usr/bin/env python3
import argparse,hashlib,json,subprocess,sys,zipfile
from datetime import datetime,timezone
from pathlib import Path
repo=Path(__file__).resolve().parents[3]
pkg=Path(__file__).resolve().parent
manifest=json.loads((pkg/'manifest.json').read_text())
p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True)
g.add_argument('--check',action='store_true');g.add_argument('--apply',action='store_true'); a=p.parse_args()
sha=lambda b:hashlib.sha256(b).hexdigest()
originals={}
for rel,spec in manifest['files'].items():
 target=repo/rel; new=pkg/'patched'/rel
 if not new.is_file() or sha(new.read_bytes()) != spec['after_sha256']:
  raise SystemExit('SAFE STOP: patch SHA mismatch '+rel)
 old=target.read_bytes() if target.is_file() else None
 if spec['before_sha256'] is None:
  if old is not None: raise SystemExit('SAFE STOP: new file unexpectedly exists: '+rel)
 elif old is None or sha(old)!=spec['before_sha256']:
  raise SystemExit('SAFE STOP: source SHA mismatch '+rel)
 originals[rel]=old
 result=subprocess.run(['node','--input-type=module','--check'],input=new.read_bytes(),capture_output=True)
 if result.returncode: raise SystemExit('SAFE STOP: ESM syntax error '+rel+' '+result.stderr.decode()[:500])
print('R2.2 B2 SHA + ESM PREFLIGHT: PASS 2 files',flush=True)
if a.check:
 print('SAFE STOP: no changes; no Luna / DB / deploy');sys.exit(0)
folder=Path.home()/'Downloads'
if not folder.is_dir():raise SystemExit('SAFE STOP: Downloads missing')
backup=folder/('PRIMA_R22_PHASE_B2_BACKUP_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.zip')
with zipfile.ZipFile(backup,'w',zipfile.ZIP_DEFLATED) as z:
 for rel,old in originals.items():
  if old is not None:z.writestr(rel,old)
 z.writestr('BACKUP_MANIFEST.json',json.dumps({'existing_files':[k for k,v in originals.items() if v is not None],'created_files':[k for k,v in originals.items() if v is None],'sha256':{k:sha(v) if v is not None else None for k,v in originals.items()}},indent=2))
with zipfile.ZipFile(backup) as z:
 if z.testzip() is not None:raise SystemExit('SAFE STOP: backup failed')
try:
 for rel in originals:
  t=repo/rel;t.parent.mkdir(parents=True,exist_ok=True)
  t.write_bytes((pkg/'patched'/rel).read_bytes())
 test=subprocess.run(['node',str(pkg/'tests.mjs')],cwd=repo,capture_output=True,text=True)
 if test.returncode:raise RuntimeError('offline tests failed: '+test.stdout+' '+test.stderr)
 print(test.stdout.strip(),flush=True)
 for rel,spec in manifest['files'].items():
  if sha((repo/rel).read_bytes())!=spec['after_sha256']:
   raise RuntimeError('post-install SHA mismatch: '+rel)
except Exception as exc:
 for rel,old in originals.items():
  t=repo/rel
  if old is None:t.unlink(missing_ok=True)
  else:t.write_bytes(old)
 print('R2.2 B2 AUTOMATIC ROLLBACK:',str(exc),flush=True)
 sys.exit(1)
print('PRIMA R2.2 B2 LOCAL APPLY: PASS',flush=True)
print('BACKUP:',backup,flush=True)
print('PRODUCTION DEPLOYS 0; LUNA 0; DB WRITES 0',flush=True)
print('NOTICE: live Search V3 and semantic answer quality NOT tested',flush=True)
