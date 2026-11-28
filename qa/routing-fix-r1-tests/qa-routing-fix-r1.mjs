import assert from 'node:assert/strict';
import { routeIntent } from '../../src/router.js';
import { decideNextActionV1 } from '../../src/decision-policy.js';
import { explicitHandoffRequest, evaluateFunnel } from '../../src/funnel.js';
import { inspectDirectContactH29 } from '../../src/direct-contact-intent-h29.js';
import { isInformationalContactInquiryV1, deniesCurrentContactAuthorizationV1, isGeneralEmirateScopeV1 } from '../../src/contact-routing-safety-v1.js';

const tests = [
  ['S15','How can I request an agent callback in the future? Do not arrange one now and do not collect my contact details.','market_question'],
  ['S16','What information would an agent need for a consultation? I am asking for an explanation, not giving permission to contact me.','market_question'],
  ['S27','A friend wrote the words "book an agent call" in a message. Explain what that phrase means, but do not book anything for me.','market_question'],
  ['S17','Do not make a lead or contact me. Just explain how mortgages usually work for property buyers in Dubai.','market_question']
];
let pass=0;
function test(label, fn) { fn(); pass++; console.log('PASS', label); }
for(const [id,msg,route] of tests) {
  test(id+' info-only detection',()=>assert.equal(isInformationalContactInquiryV1(msg),true));
  test(id+' no authorization',()=>assert.equal(deniesCurrentContactAuthorizationV1(msg),true));
  test(id+' safe routing',()=>assert.equal(routeIntent(msg,{}),route));
  test(id+' no explicit handoff',()=>assert.equal(explicitHandoffRequest(msg),false));
  test(id+' no H29 direct request',()=>assert.equal(inspectDirectContactH29(msg).direct_request,false));
  test(id+' no funnel lead',()=>assert.equal(evaluateFunnel({message:msg,route,fullContext:true}).lead_action,null));
}
const positive = [
  'Please call me tomorrow.',
  'Please connect me with an agent.',
  'I would like to speak with a Primadom advisor.',
  'Can your team email me? Please connect me with your team.'
];
for(const msg of positive) {
  test('positive request not blocked: '+msg,()=>assert.equal(isInformationalContactInquiryV1(msg),false));
}
test('genuine direct request still Handoff',()=>assert.equal(explicitHandoffRequest('Please contact me tomorrow.'),true));
test('contact route without verified authorization blocked',()=>assert.deepEqual(
  [decideNextActionV1({route:'contact_intent',contactAuthorization:false}).action,decideNextActionV1({route:'contact_intent',contactAuthorization:false}).reason],
  ['CLARIFY','contact_not_authorized_routing_qa']));
test('authorized route CONTACT unchanged',()=>assert.equal(decideNextActionV1({route:'contact_intent',contactAuthorization:true}).action,'CONTACT'));
test('S24: Luna advisory + market_question is allowed',()=>assert.equal(decideNextActionV1({route:'page_question',lunaInterpretation:{primary_route:'market_question'},lunaDecision:{next_action:'ADVISORY', confidence:0.96}}).action,'ADVISORY'));
test('knowledge QA remains Knowledge',()=>assert.equal(decideNextActionV1({route:'market_question',lunaInterpretation:{primary_route:'market_question'},lunaDecision:{next_action:'KNOWLEDGE_QA', confidence:0.95}}).action,'KNOWLEDGE_QA'));
test('search remains SEARCH',()=>assert.equal(decideNextActionV1({route:'property_search',lunaInterpretation:{primary_route:'property_search'},lunaDecision:{next_action:'SEARCH', confidence:0.95}}).action,'SEARCH'));
test('no contact for in-domain quote',()=>assert.equal(routeIntent('Explain the phrase "please call an agent"; do not call anyone.',{}),'market_question'));


test('S14 Dubai is geographic scope, not ambiguous named entity',()=>assert.equal(isGeneralEmirateScopeV1({message:'What is the difference between freehold and leasehold property ownership in Dubai?',route:'page_question',entityName:'Dubai'}),true));
test('S17 Dubai is geographic scope, not ambiguous named entity',()=>assert.equal(isGeneralEmirateScopeV1({message:'Do not make a lead or contact me. Just explain how mortgages usually work for property buyers in Dubai.',route:'page_question',entityName:'Dubai'}),true));
test('specific project name preserved',()=>assert.equal(isGeneralEmirateScopeV1({message:'What is Dubai Creek Harbour?',route:'page_question',entityName:'Dubai Creek Harbour'}),false));
test('exact fact route preserved',()=>assert.equal(isGeneralEmirateScopeV1({message:'What is a development in Dubai?',route:'exact_fact',entityName:'Dubai'}),false));

console.log('===== PRIMA ROUTING R1 STATIC UNIT PASS =====', pass);
