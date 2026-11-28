#!/usr/bin/env node
'use strict';
// Static, read-only model transport inventory; heuristic by design, no secrets or source snippets.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=process.cwd(),src=path.join(root,'src');
if(!fs.existsSync(path.join(src,'index.js')))throw Error('Run in PRIMA Worker repository');
let ts;for(const p of [path.join(root,'qa/full-pipeline/.tools/node_modules/typescript'),'typescript'])try{ts=require(p);break}catch{}
if(!ts)throw Error('TypeScript QA parser missing. Existing R2.24.20 builder requires it.');
const all=[];
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&/\.m?js$/.test(e.name))all.push(p)}}walk(src);
const found=[];
for(const f of all){const rel=path.relative(root,f),raw=fs.readFileSync(f,'utf8'),sf=ts.createSourceFile(rel,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 function visit(n){if(ts.isCallExpression(n)){
 const expression=n.expression.getText(sf),arg=n.arguments[0]?.getText(sf)||'';
 let category=null;
 if(/^(?:globalThis\.)?fetch$/.test(expression)||/\b(?:qaSupabaseFetch|fetchReadWithRetry)\b/.test(expression)) category='fetch_transport';
 else if(/\b(?:responses|chat\.completions|messages|generateContent)\.create$/.test(expression)||/\.generateContent$/.test(expression))category='provider_sdk_candidate';
 if(category){const context=raw.slice(Math.max(0,n.getStart(sf)-500),Math.min(raw.length,n.end+150));
 const providerHint=/api\.openai\.com|OPENAI_API_KEY|openai\.com/.test(context)?'openai_possible':/api\.anthropic\.com|ANTHROPIC_API_KEY/.test(context)?'anthropic_possible':/generativelanguage\.googleapis\.com|GEMINI_API_KEY/.test(context)?'google_possible':'unknown';
 found.push({file:rel,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,kind:category,provider_hint:providerHint,expression:expression.slice(0,90)});
 }}ts.forEachChild(n,visit)}visit(sf);
}
const out={contract:'R22431_STATIC_MODEL_INVENTORY',source:'CURRENT_WORKTREE',candidate_sites:found,notes:[
 'STATIC CANDIDATES ONLY: does not prove these sites execute in a scenario.',
 'UNKNOWN URL construction, imports and SDKs may evade this heuristic inventory.',
 'Provider HTTP accounting requires runtime pairing for all executed paths.',
 'Search V3 browser execution is outside this inventory.'
]};
const dir=path.join(root,'qa/full-pipeline/reports');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'r22431-model-transport-inventory.json'),JSON.stringify(out,null,2)+'\n');
console.log('===== R2.24.31 MODEL TRANSPORT INVENTORY =====');
console.log('SCANNED MODULES:',all.length,'CANDIDATE CALL SITES:',found.length);
for(const row of found.filter(x=>x.provider_hint!=='unknown'||x.kind==='provider_sdk_candidate').slice(0,35))console.log(`${row.file}:${row.line} | ${row.kind} | ${row.provider_hint}`);
console.log('GLOBAL ALL-PROVIDER RECONCILIATION: NOT_VERIFIED (requires executed-path ledger)');
console.log('REPORT: qa/full-pipeline/reports/r22431-model-transport-inventory.json');
