import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  shouldDeferMarketFallbackToComposerV2 as market,
  hasIndependentInformationalQuestionV2 as independent,
  shouldPrioritizeIndependentAnswerOverFunnelV2 as prioritize
} from '../../src/answer-priority-v2.js';

let checks=0;
function eq(a,b,label){ assert.equal(a,b,label); checks++; }

for (const action of ['KNOWLEDGE_QA','ADVISORY']) {
  eq(market({route:'market_question',action}),true,'semantic conversational market answer '+action);
}
for (const action of ['SEARCH','CONTACT','CLARIFY','REFERENCE','PROFILE_UPDATE',null]) {
  eq(market({route:'market_question',action}),false,'no bypass for '+action);
}
for (const route of ['page_question','recommendation','contact_intent','property_search','persona_question']) {
  eq(market({route,action:'KNOWLEDGE_QA'}),false,'other route '+route);
}

for (const message of [
  'Maybe I will speak with an agent next month, but I do not want any calls or messages now. What can I research first?',
  'Do not contact me. How should I evaluate options before buying?',
  'Please do not call me; which documents should I read?',
  'I do not want calls right now, but what is important to learn before investing?',
  'No calls, and why is the escrow account important?',
]) eq(independent(message),true,'independent substantive question');
for (const message of [
  'Do not contact me now.',
  'Please do not call me again, okay?',
  'No thanks, I do not want any calls.',
  'My colleague quoted the phrase book an agent call.',
  'I do not want messages anymore.',
]) eq(independent(message),false,'pure refusal or quote');

const refusalDecision = {response_type:'answer',answer_override:'Understood.',
  lead_action:null,follow_up:null,memory_facts:[
    {fact_key:'funnel_state',fact_value:{status:'contact_opted_out'}}]};
eq(prioritize({hasOtherTask:true,consent:false,action:'ADVISORY',decision:refusalDecision}),true,'S18 advisory survives optout acknowledgement');
eq(prioritize({hasOtherTask:true,consent:false,action:'KNOWLEDGE_QA',decision:refusalDecision}),true,'knowledge question survives optout acknowledgement');
eq(prioritize({hasOtherTask:false,consent:false,action:'ADVISORY',decision:refusalDecision}),false,'pure optout keeps original acknowledgement');
eq(prioritize({hasOtherTask:true,consent:true,action:'ADVISORY',decision:refusalDecision}),false,'granted consent cannot be altered');
eq(prioritize({hasOtherTask:true,consent:false,action:'SEARCH',decision:refusalDecision}),false,'search is not redirected');
eq(prioritize({hasOtherTask:true,consent:false,action:'ADVISORY',decision:{...refusalDecision,lead_action:{type:'request_contact'}}}),false,'never bypass lead transition');
eq(prioritize({hasOtherTask:true,consent:false,action:'ADVISORY',decision:{...refusalDecision,memory_facts:[]}}),false,'never suppress unrelated Funnel answer');

const src=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
assert.ok(src.includes('shouldDeferMarketFallbackToComposerV2({'),'index uses semantic composer priority');checks++;
assert.ok(src.includes('hasIndependentInformationalQuestionV2(normalized)'),'optout preserves other task');checks++;
assert.ok(src.includes('shouldPrioritizeIndependentAnswerOverFunnelV2({'),'index preserves substantive task after Funnel');checks++;
assert.ok(src.includes('const baseAnswer =') && src.includes('funnelDecision'), 'existing funnel owner remains');checks++;
assert.ok(src.includes('const useOpenAI =') && src.includes('!funnelDecision'), 'composer cannot override contact decisions');checks++;
console.log('PRIMA R2 ANSWER PRIORITY — '+checks+' LOCAL ASSERTIONS PASS');
