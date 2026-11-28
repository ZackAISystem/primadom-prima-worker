#!/usr/bin/env python3
"""SHA-guarded local patch; no network, no DB and no deploy.
Usage: python3 qa/full-pipeline/routing-fix-r1/install.py --check|--apply
"""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,datetime,sys

this=Path(__file__).resolve()
repo=this.parents[3]
pkg=this.parent
manifest=json.loads((pkg/'manifest.json').read_text())
sha=lambda x:hashlib.sha256(x.read_bytes()).hexdigest()
p=argparse.ArgumentParser()
p.add_argument('--apply',action='store_true',help='Install locally with backups + run unit QA')
p.add_argument('--check',action='store_true',help='Only verify source checksums')
args=p.parse_args()
changed=manifest['changed_files']
new=manifest['new_files']
preflight=[]
for name,info in changed.items():
    file=repo/name
    if not file.is_file(): raise SystemExit('BLOCKED_MISSING '+str(file))
    digest=sha(file)
    if digest not in (info['original_sha256'],info['patched_sha256']):
        raise SystemExit('BLOCKED_SOURCE_SHA_MISMATCH '+str(file)+' '+digest)
    patch=pkg/'patched'/name
    if sha(patch)!=info['patched_sha256']:
        raise SystemExit('BLOCKED_ARCHIVE_CORRUPTION '+str(patch))
    preflight.append((file,patch,digest!=info['patched_sha256']))
for name,digest in new.items():
    file=repo/name
    patch=pkg/'patched'/name
    if sha(patch)!=digest:raise SystemExit('BLOCKED_ARCHIVE_CORRUPTION '+str(patch))
    if file.exists() and sha(file)!=digest:raise SystemExit('BLOCKED_NEW_FILE_COLLISION '+str(file))
print('===== PRIMA ROUTING FIX R1 SAFE PREFLIGHT =====')
print('REPO',repo)
print('MATCHED',len(changed),'modified source files +',len(new),'new helper')
print('TO_INSTALL',sum(x[2] for x in preflight)+sum(not (repo/name).exists() for name in new))
print('WORKER SOURCE CURRENT: MATCHES UPLOADED EVIDENCE OR PATCH')
if not args.apply:
    print('CHECK PASS. No file changed; use --apply to install.')
    raise SystemExit(0)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=pkg/'backups'/stamp
orig=[]
try:
    for file,patch,needs_change in preflight:
        if not needs_change:continue
        dest=backup/file.relative_to(repo)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(file,dest)
        orig.append((file,dest,True))
        tmp=file.with_name(file.name+'.prima-r1-install-tmp')
        shutil.copy2(patch,tmp)
        os.replace(tmp,file)
    for name in new:
        file=repo/name
        if file.exists():continue
        file.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(pkg/'patched'/name,file)
        orig.append((file,None,False))
    for file,patch,_ in preflight:
        proc=subprocess.run(['node','--input-type=module','--check'],input=file.read_text(),cwd=repo,text=True,capture_output=True,timeout=30)
        if proc.returncode: raise RuntimeError('NODE_SYNTAX_ERROR '+str(file)+' '+proc.stderr[-700:])
    for name in new:
        proc=subprocess.run(['node','--input-type=module','--check'],input=(repo/name).read_text(),cwd=repo,text=True,capture_output=True,timeout=30)
        if proc.returncode: raise RuntimeError('NODE_SYNTAX_ERROR '+name+' '+proc.stderr[-700:])
    loader=repo/'qa/full-pipeline/runners/esm-loader.mjs'
    if not loader.exists(): raise RuntimeError('QA_LOADER_MISSING '+str(loader))
    test_script=repo/manifest['tests']
    proc=subprocess.run(['node','--no-warnings','--experimental-loader',str(loader),str(test_script)],cwd=repo,text=True,capture_output=True,timeout=90)
    print(proc.stdout)
    if proc.returncode:raise RuntimeError('UNIT_TEST_FAILURE '+proc.stderr[-1500:])
    print('===== PRIMA ROUTING R1 LOCAL PATCH PASS =====')
    print('BACKUP:',backup)
    print('PRODUCTION DEPLOY: NONE | LIVE DB: NONE | LUNA REQUESTS: NONE')
except Exception as e:
    for file,saved,was_original in reversed(orig):
        if was_original:shutil.copy2(saved,file)
        elif file.exists():file.unlink()
    print('ROLLBACK DONE; ERROR:',str(e),file=sys.stderr)
    raise SystemExit(2)
