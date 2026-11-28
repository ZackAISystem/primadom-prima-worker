import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('src/index.js','utf8');
const checks=[
 ['server checkpoint typed', 'CompoundCompareCheckpointV1'],
 ['checkpoint stored one place', 'compound_compare_v1:compoundCompareCheckpointV1'],
 ['checkpoint exact turn', 'pendingV12?.turn_id===turn.turn_id'],
 ['checkpoint query matched', 'body?.search_context?.query===pendingV12.search_query'],
 ['checkpoint results validated', 'Boolean(normalizeSearchContextV1(body.search_context))'],
 ['no unguarded search', 'nextAction?.action === "SEARCH" && !r22NoSearch'],
 ['CAS state guard', 'supabaseUpdateReturning(env,"conversations"'],
 ['fail closed when unsaved', 'pendingChanges.length > 0 || compoundCompareCheckpointV1'],
 ['continuation status', 'completedCompareSearchContinuationV1'],
 ['honest partial state', 'completion_status:"partial"'],
 ['no false completed comparison', 'comparison_status:"pending"'],
 ['trace checkpoint restored', 'compound_comparison_restored'],
 ['trace comparison pending', 'compound_comparison_pending'],
 ['no new contact grant', 'p0BeforeDecision.consent'],
 ['search tool validation', 'PrimaToolRequestV1'],
];
for (const [name,term] of checks)assert(source.includes(term),name);
const result=spawnSync('node',['--input-type=module','--check'],{input:source,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
console.log('R2.2 PHASE B1 STATIC + ESM OFFLINE CHECKS PASS:',checks.length+1);
