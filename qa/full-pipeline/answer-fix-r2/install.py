#!/usr/bin/env python3
"""SHA-guarded PRIMA Answer Priority R2 installer. No live calls or deploy."""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess,datetime,os,sys
pkg=Path(__file__).resolve().parent
repo=pkg.parents[2]
manifest=json.loads((pkg/'manifest.json').read_text())
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
parser=argparse.ArgumentParser()
parser.add_argument('--check',action='store_true')
parser.add_argument('--apply',action='store_true')
a=parser.parse_args()
if a.apply and a.check:raise SystemExit('Choose --check OR --apply')
changes=[]
for name,info in manifest['changed_files'].items():
    file=repo/name;patch=pkg/'patched'/name
    if not file.exists():raise SystemExit('BLOCKED_SOURCE_MISSING '+name)
    if sha(patch)!=info['patched_sha256']:raise SystemExit('BLOCKED_PACKAGE_CORRUPT '+name)
    actual=sha(file)
    if actual not in (info['original_sha256'],info['patched_sha256']):
        raise SystemExit('BLOCKED_SOURCE_SHA_MISMATCH '+name+' '+actual)
    changes.append((file,patch,actual!=info['patched_sha256']))
for name,digest in manifest['new_files'].items():
    file=repo/name;patch=pkg/'patched'/name
    if sha(patch)!=digest:raise SystemExit('BLOCKED_PACKAGE_CORRUPT '+name)
    if file.exists() and sha(file)!=digest:raise SystemExit('BLOCKED_HELPER_COLLISION '+name)
print('R2 SHA PREFLIGHT PASS | to_install',sum(x[2] for x in changes))
if not a.apply:
    print('SAFE STOP. Nothing modified. Use --apply to install locally.')
    raise SystemExit(0)
backup=pkg/'backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
updated=[]
try:
    for path,patch,needed in changes:
        if not needed:continue
        save=backup/path.relative_to(repo)
        save.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(path,save)
        tmp=path.with_name(path.name+'.prima-r2-tmp')
        shutil.copy2(patch,tmp)
        os.replace(tmp,path)
        updated.append((path,save))
    added=[]
    for name in manifest['new_files']:
        path=repo/name
        if path.exists():continue
        path.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(pkg/'patched'/name,path)
        added.append(path)
    for name in ['src/index.js','src/answer-priority-v2.js']:
        proc=subprocess.run(['node','--input-type=module','--check'],input=(repo/name).read_text(),capture_output=True,text=True,timeout=45)
        if proc.returncode:raise RuntimeError('NODE_SYNTAX_FAIL '+name+' '+proc.stderr)
    proc=subprocess.run(['node','--no-warnings','--experimental-loader',str(repo/'qa/full-pipeline/runners/esm-loader.mjs'),str(repo/manifest['tests'])],cwd=repo,capture_output=True,text=True,timeout=45)
    print(proc.stdout)
    if proc.returncode:raise RuntimeError('UNIT_QA_FAIL '+proc.stderr)
    print('R2 LOCAL PASS | source backup',backup)
    print('NO LUNA CALLS | NO DB WRITES | NO DEPLOY')
except Exception as ex:
    for path in reversed(locals().get('added',[])):
        if path.exists():path.unlink()
    for path,save in reversed(updated):shutil.copy2(save,path)
    print('ROLLBACK DONE',ex,file=sys.stderr)
    raise SystemExit(2)
