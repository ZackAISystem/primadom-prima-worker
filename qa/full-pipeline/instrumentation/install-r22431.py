#!/usr/bin/env python3
"""QA-only, idempotent: enrich safe boundary fields in generated tracing runtime."""
from pathlib import Path
import subprocess, shutil
ROOT=Path(__file__).resolve().parents[3]
builder=ROOT/'qa/full-pipeline/instrumentation/build-live-function-trace.cjs'
if not builder.is_file():raise SystemExit('BLOCKED: R2.24.29 QA builder not found')
s=builder.read_text()
old="for(const k of ['version','phase','entity_type','language','state','tool','response_type','next_action']){"
new="for(const k of ['version','phase','entity_type','language','language_code','state','tool','route','action','response_type','next_action','property_type']){"
oldnums="for(const k of ['result_count','total_count','max_results']){"
newnums="for(const k of ['result_count','total_count','max_results','min_price','max_price','min_budget','max_budget','bedrooms','limit','offset']){"
oldnested="for(const k of ['results','projects','cards','filters','turn','search_context']){"
newnested="for(const k of ['results','projects','cards','turn','search_context']){"
marker=" return out;\n}\nlet providerObserverInstalled=false;"
addition=""" // Only explicitly permitted structured search-filter keys; never free text, user identifiers or prompts.
 try{if(value.filters&&typeof value.filters==='object'&&!Array.isArray(value.filters)){
  const f={};for(const k of ['min_price','max_price','min_budget','max_budget','bedrooms','limit','offset']){
   const v=value.filters[k];if(Number.isSafeInteger(v)&&v>=0)f[k]=v;
  }
  for(const k of ['property_type','language_code']){
   const v=value.filters[k];if(typeof v==='string'&&v.length<=32&&/^[a-zA-Z0-9_-]+$/.test(v))f[k]=v;
  }
  if(Object.keys(f).length)out.safe_filters=f;
 }}catch{}
 return out;
}
let providerObserverInstalled=false;"""
if 'out.safe_filters=f;' in s:
 print('R2.24.31 ALREADY INSTALLED')
else:
 for a,b in ((old,new),(oldnums,newnums),(oldnested,newnested),(marker,addition)):
  if s.count(a)!=1:raise SystemExit(f'BLOCKED: expected unique patch anchor not found ({a[:65]}). No changes made.')
  s=s.replace(a,b,1)
 backup=builder.with_name(builder.name+'.bak-r22431')
 if backup.exists():raise SystemExit('BLOCKED: backup exists with an unknown state')
 shutil.copy2(builder,backup)
 builder.write_text(s)
 print('R2.24.31 QA BUILDER PATCHED; BACKUP:',backup.relative_to(ROOT))
subprocess.run(['node','--check',str(builder)],cwd=ROOT,check=True)
print('SOURCE src/: UNCHANGED; SUPABASE: NO CALLS; DEPLOY: NONE')
