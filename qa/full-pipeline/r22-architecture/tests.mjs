import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const root = process.cwd();
const stage = mkdtempSync(join(tmpdir(), 'prima-r22-tests-'));
cpSync(resolve(root,'src'),join(stage,'src'),{recursive:true});
writeFileSync(join(stage,'package.json'),JSON.stringify({type:'module'}));
process.on('exit',()=>rmSync(stage,{recursive:true,force:true}));
const mod = async name => await import(pathToFileURL(resolve(stage,'src',name)).href);
const {buildTypedTaskPlanV1,hasExplicitNoSearchV1}=await mod('task-plan-v1.js');
const {decideNextActionV1,authorizePrimaSearchV12}=await mod('decision-policy.js');
const {requiresNamedEntityClarificationV1}=await mod('entity-resolver.js');
const {buildPrimaSearchRequest}=await mod('prima-search-request.js');
const valid = {
  primary_route:'compare',
  tasks:[
    {route:'compare',needs_clarification:false},
    {route:'property_search',needs_clarification:false}
  ]
};
const plan=buildTypedTaskPlanV1({interpretation:valid,phase:'initial'});
assert.equal(plan.mode,'compare_and_search');
const auth = (changes={}) => decideNextActionV1({
  route:'compare',
  lunaDecision:{next_action:'SEARCH',confidence:.99},
  lunaInterpretation:valid,
  typedTaskPlan:plan,
  contactAuthorization:false,
  ...changes
});
assert.equal(auth().action,'SEARCH');
assert.equal(auth().reason,'typed_multitask_search_authorized_r22');
assert.equal(authorizePrimaSearchV12({decision:auth(),route:'compare',phase:'initial'}),true);
assert.equal(authorizePrimaSearchV12({decision:auth(),route:'compare',phase:'tool_continuation'}),false);
assert.equal(auth({searchProhibited:true}).action,'CLARIFY');
assert.equal(auth({lunaDecision:{next_action:'SEARCH',confidence:.5}}).action,'COMPARE');
assert.equal(auth({lunaInterpretation:{primary_route:'compare',tasks:[{route:'compare'}]}}).action,'CLARIFY');
assert.equal(buildTypedTaskPlanV1({interpretation:{...valid,tasks:[valid.tasks[0]]}}).mode,'single_or_other');
assert.equal(buildTypedTaskPlanV1({interpretation:{...valid,tasks:[valid.tasks[0],{route:'contact_intent'}]}}).mode,'single_or_other');
assert.equal(buildTypedTaskPlanV1({interpretation:{...valid,tasks:[valid.tasks[0],{...valid.tasks[1],needs_clarification:true}]}}).mode,'single_or_other');
assert.equal(buildTypedTaskPlanV1({interpretation:valid,phase:'tool_continuation'}).mode,'single_or_other');
assert.equal(decideNextActionV1({route:'contact_intent',lunaDecision:{next_action:'CONTACT',confidence:1},contactAuthorization:false}).action,'CLARIFY');
assert.equal(hasExplicitNoSearchV1('Please explain this filter. I do not want you to search.'),true);
assert.equal(hasExplicitNoSearchV1('Compare and find projects'),false);
assert.equal(hasExplicitNoSearchV1('I do not want property listings.'),true);
const candidate={status:'not_found',entity_name:'apartments'};
const concept={entities:[{type:'property_type',name:'apartments'}],tasks:[{route:'exact_fact',requested_facts:[]}]};
assert.equal(requiresNamedEntityClarificationV1({action:'KNOWLEDGE_QA',interpretation:concept,resolution:candidate}),false);
assert.equal(requiresNamedEntityClarificationV1({action:'EXACT_FACT',interpretation:concept,resolution:candidate}),true);
assert.equal(requiresNamedEntityClarificationV1({action:'KNOWLEDGE_QA',interpretation:{...concept,tasks:[{requested_facts:['price']}]},resolution:candidate}),true);
assert.equal(requiresNamedEntityClarificationV1({action:'KNOWLEDGE_QA',interpretation:{entities:[{type:'project',name:'Some Tower'}],tasks:[{requested_facts:[]}]},resolution:candidate}),true);
const sr=buildPrimaSearchRequest({route:'property_search',message:'Find one-bedroom projects under AED 1.5 million in JVC',context:null});
assert.equal(sr?.tool,'prima_search');
assert.equal(sr?.action,'search_projects');
console.log('PRIMA R2.2 PHASE A OFFLINE ASSERTIONS PASS: 20');
