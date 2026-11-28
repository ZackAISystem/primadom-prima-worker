#!/usr/bin/env python3
"""PRIMA R2.24.34: opt-in tracing of EXISTING bridge, no search implementation.
Changes only two frontend source files with backups; does not deploy/run browser/DB.
Idempotent and fails closed when source anchors differ.
"""
from pathlib import Path
import sys, shutil, subprocess, hashlib, json
ROOT=Path.home()/"zack-ai/zack-factory"
APP=ROOT/'primadom-prima/assets/prima.js'
SEARCH=ROOT/'client-primadom-new/layouts/partials/home/search_engine.html'
MARK='PRIMA_BRIDGE_OBSERVABILITY_R22434'

# No prompt, message text, auth, tokens, headers, or personal IDs are logged.
TRACE_HELPER=r'''
/* PRIMA_BRIDGE_OBSERVABILITY_R22434 — opt-in, local console only. */
function __primaBridgeTraceR22434(stage, payload) {
  try {
    if (typeof window === 'undefined' || window.__PRIMA_TECHNICAL_TRACE_V1__ !== true) return;
    const x = payload && typeof payload === 'object' ? payload : {};
    const event = {
      version: 'PRIMA_BRIDGE_OBSERVABILITY_R22434',
      stage: String(stage).slice(0,64),
      ts: Date.now(),
      source: String(x.source || '').slice(0,60),
      phase: String(x.phase || '').slice(0,32),
      request_id: String(x.request_id || '').slice(0,90),
      turn_id: String(x.turn_id || '').slice(0,90),
      tool: String(x.tool || '').slice(0,40),
      version_name: String(x.version || '').slice(0,50),
      state: String(x.state || '').slice(0,32),
      result_count: Number.isFinite(Number(x.result_count)) ? Number(x.result_count) : null,
      result_slugs: Array.isArray(x.results) ? x.results.slice(0,10).map(z=>String(z?.slug || '').slice(0,110)) : [],
      http_status: Number.isInteger(x.http_status) ? x.http_status : null,
      duration_ms: Number.isFinite(x.duration_ms) ? x.duration_ms : null,
      filter_keys: x.filters && typeof x.filters==='object' ? Object.keys(x.filters).slice(0,30).filter(k=>/^[a-z][a-z0-9_]{0,39}$/i.test(k)) : []
    };
    const buf = window.__PRIMA_BRIDGE_TRACE_EVENTS_V1__ ||= [];
    buf.push(event); if (buf.length>500) buf.shift();
    console.info('PRIMA_BRIDGE_TRACE', JSON.stringify(event));
  } catch (_) { /* tracing cannot alter search behavior */ }
}
'''

def replace_one(source, old, new, label):
    count=source.count(old)
    if count!=1:
        raise ValueError(f'{label}: expected exactly 1 anchor, got {count}. NO CHANGES')
    return source.replace(old,new,1)

def modify_app(src):
    if MARK in src: return src, 'ALREADY_INSTALLED'
    src=replace_one(src, 'async function runPrimaProjectSearchBridge(\n  request\n) {',
      'async function runPrimaProjectSearchBridge(\n  request\n) {\n  __primaBridgeTraceR22434("bridge_request", {source:"prima.js",tool:request?.tool,version:request?.version,phase:"initial",filters:request?.filters});', 'app_bridge')
    # Capture REAL settlement of the existing postMessage bridge, not a synthetic SearchContext.
    src=replace_one(src,'        fn(value);\n      };',
       '        __primaBridgeTraceR22434("bridge_settle", {source:"prima.js",request_id:requestId,version:value?.version,state:value?.state,results:value?.results,result_count:value?.result_count,filters:value?.filters});\n        fn(value);\n      };', 'app_settle')
    src=replace_one(src, 'async function postJson(\n  path,\n  body\n) {',
      'async function postJson(\n  path,\n  body\n) {\n  const __primaTraceStartR22434 = Date.now();\n  if(path === "/api/prima/message") __primaBridgeTraceR22434("worker_wire_request", {source:"prima.js",phase:body?.turn?.phase,turn_id:body?.turn?.turn_id,version:body?.search_context?.version,results:body?.search_context?.results,result_count:body?.search_context?.result_count,filters:body?.search_context?.filters});', 'app_postjson')
    # Scope: occurs at end of postJson, not arbitrary return data elsewhere.
    block_start=src.index('async function postJson(\n  path,\n  body\n) {')
    block_end=src.index('\n}\n',block_start)+2
    block=src[block_start:block_end]
    block=replace_one(block,'  return data;',
      '  if(path === "/api/prima/message") __primaBridgeTraceR22434("worker_wire_response", {source:"prima.js",phase:data?.turn?.phase,turn_id:data?.turn?.turn_id,version:data?.version,state:data?.response_type,http_status:response.status,duration_ms:Date.now()-__primaTraceStartR22434});\n  return data;', 'app_post_return')
    src=src[:block_start]+block+src[block_end:]
    return TRACE_HELPER+'\n'+src, 'PATCHED'

def modify_search(src):
    if MARK in src: return src,'ALREADY_INSTALLED'
    anchor='function publishSearchContextV1({' 
    n=src.count(anchor)
    if n!=1: raise ValueError(f'search_publish: expected exactly 1 anchor, got {n}. NO CHANGES')
    i=src.index(anchor)
    # JS destructured argument closes as `}) {`, allow flexible whitespace. Stay within signature.
    import re
    match=re.search(r'\}\s*\)\s*\{',src[i:i+1200])
    if not match: raise ValueError('search_publish: cannot safely locate function body. NO CHANGES')
    pos=i+match.end()
    injection='\n  __primaBridgeTraceR22434("search_publish_call", {source:"search_engine.html", phase:typeof SEARCH_CONTEXT_CHANNEL!=="undefined"?SEARCH_CONTEXT_CHANNEL:"", version:arguments[0]?.version, state:arguments[0]?.state, filters:arguments[0]?.filters, results:arguments[0]?.results, result_count:arguments[0]?.result_count});\n'
    src=src[:pos]+injection+src[pos:]
    # Inject into the same script containing the function, not outside Hugo template.
    script_start=src.rfind('<script',0,i)
    script_end=src.rfind('</script',0,i)
    if script_start<0 or script_start<script_end:
        raise ValueError('search_publish: script block not located. NO CHANGES')
    open_tag=src.find('>',script_start,i)
    if open_tag<0: raise ValueError('search_publish: malformed script tag. NO CHANGES')
    src=src[:open_tag+1]+'\n'+TRACE_HELPER+'\n'+src[open_tag+1:]
    return src,'PATCHED'

def main():
    for p in (APP,SEARCH):
        if not p.is_file(): raise SystemExit(f'BLOCKED: required source missing: {p}')
    old_a=APP.read_text(encoding='utf8');old_s=SEARCH.read_text(encoding='utf8')
    try:
        new_a, status_a=modify_app(old_a)
        new_s, status_s=modify_search(old_s)
    except ValueError as e: raise SystemExit(f'BLOCKED: {e}')
    if status_a!=status_s and 'ALREADY_INSTALLED' in (status_a,status_s):
        raise SystemExit('BLOCKED: partial pre-existing installation; no files modified')
    # static syntax check on app before touching source files
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        temp=Path(td)/'prima.js';temp.write_text(new_a,encoding='utf8')
        node=subprocess.run(['node','--check',str(temp)],capture_output=True,text=True)
        if node.returncode: raise SystemExit('BLOCKED: patched prima.js syntax invalid: '+node.stderr[:600])
    if status_a=='PATCHED':
        for p,old in ((APP,old_a),(SEARCH,old_s)):
            backup=p.with_name(p.name+'.bak-r22434')
            if backup.exists(): raise SystemExit(f'BLOCKED: backup already exists: {backup}')
        APP.with_name(APP.name+'.bak-r22434').write_text(old_a,encoding='utf8')
        SEARCH.with_name(SEARCH.name+'.bak-r22434').write_text(old_s,encoding='utf8')
        APP.write_text(new_a,encoding='utf8');SEARCH.write_text(new_s,encoding='utf8')
    print('===== PRIMA R2.24.34 EXISTING BRIDGE OBSERVABILITY =====')
    print('APP:',status_a,APP)
    print('SEARCH:',status_s,SEARCH)
    print('TRACE: OPT-IN only; default OFF; events in window.__PRIMA_BRIDGE_TRACE_EVENTS_V1__')
    print('SOURCE WORKER: UNCHANGED | DB: NO CALLS | DEPLOY: NONE')
    print('VALIDATION: app syntax PASS; search source anchors PASS')
    print('RUNTIME BRIDGE E2E: NOT_VERIFIED until observed in a real user session')
if __name__=='__main__':main()
