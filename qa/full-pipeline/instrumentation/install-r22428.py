#!/usr/bin/env python3
"""Install QA-only runner R2.24.28; does not change src, deploy or access DB."""
from pathlib import Path
import hashlib,shutil,sys
root=Path(__file__).resolve().parents[3]
target=root/'qa/full-pipeline/runners/search-continuation-trace.py'
source=root/'qa/full-pipeline/runners/search-continuation-trace-r22428.py.txt'
if not target.is_file() or not source.is_file():
    sys.exit('BLOCKED: R2.24.25 runner and R2.24.28 payload required')
current=target.read_text()
if 'def provenance_and_lineage(report)' in current:
    print('R2.24.28 ALREADY INSTALLED');sys.exit(0)
required=['def wire_identity(body, response, status):','def provenance_and_lineage(report):']
text=source.read_text()
if not all(r in text for r in required):sys.exit('BLOCKED: invalid payload')
if hashlib.sha256(current.encode('utf-8')).hexdigest() != '0e48fbffa93f8ba16cbd90d010b09be9bda0a46d6c3a3259b6045d2930c4f51a':
    sys.exit('BLOCKED: unknown runner version; original remains untouched')
backup=target.with_suffix('.py.bak-r22428')
if backup.exists():sys.exit('BLOCKED: existing R2.24.28 backup, do not overwrite')
shutil.copy2(target,backup)
target.write_text(text)
try:compile(target.read_text(),str(target),'exec')
except Exception:
    shutil.copy2(backup,target)
    raise
print('R2.24.28 INSTALLED — QA RUNNER ONLY')
print('BACKUP:',backup.relative_to(root))
print('SOURCE MODIFIED: 0 | DEPLOY: 0 | DB: 0')
print('NEXT: python3 qa/full-pipeline/runners/search-continuation-trace.py --live-db')
