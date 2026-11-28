/*
 * PRIMA FIX03 — GENERAL CONCEPT / VERIFIED FACT BOUNDARY
 * Pure classification helper. No data access, tools, or contact actions.
 * This does not replace Luna or DecisionPolicy and never authorizes
 * search, contact, live facts, pricing, or entity-specific assertions.
 */
function tidy(input) {
  return String(input ?? "").replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

const liveOrEntityFact = /\b(?:current|latest|today|right now|this week|live|real[- ]time|exact (?:price|date|number|figure|rate)|verified (?:date|price|handover|availability)|availability|available (?:now|today)|in stock|specific (?:project|unit|listing)|particular (?:project|unit|listing)|how much (?:does|is|will)|starting price|handover date|completion date|service[- ]charge rate|per (?:sq\.?\s?ft|square foot)|guarantee(?:d)? (?:return|yield)|project (?:named|called)|developer (?:named|called))\b/i;
const forbiddenExecutor = new Set(['CONTACT','SEARCH','COMPARE','PERSONA','PROFILE_UPDATE','OFF_TOPIC','MEMORY_RECALL','PAGE_MORE','RESUME_SEARCH','REFERENCE']);

function extractDefinitionTerm(s) {
  let m = s.match(/\b(?:what does|what do)\s+["']?(.{2,80}?)["']?\s+mean\b/i);
  if (m) return m[1].replace(/["' ]+$/g,'').trim();
  m = s.match(/\b(?:meaning of|definition of)\s+["']?([^?;.!]{2,80})/i);
  if (m) return m[1].replace(/["' ]+$/g,'').trim();
  m = s.match(/\b(?:define|explain (?:the )?(?:word|term|phrase|concept))\s+["']?([^?;.!]{2,80})/i);
  if (m) return m[1].replace(/["' ]+$/g,'').trim();
  m = s.match(/\bwhat (?:is|are)\s+(?:the\s+)?(?:meaning of\s+|definition of\s+|term\s+)["']?([^?;.!]{2,80})/i);
  if (m) return m[1].replace(/["' ]+$/g,'').trim();
  return null;
}

export function classifyGeneralConceptDefinitionV1({message='',route=null,action=null}={}) {
  const s=tidy(message);
  const fail=reason=>({eligible:false,reason,term:null,version:'GeneralConceptDefinitionV1'});
  if (!s || s.length > 600) return fail('message_absent_or_too_long');
  if (forbiddenExecutor.has(action) || !['EXACT_FACT','KNOWLEDGE_QA','ADVISORY'].includes(action)) return fail('executor_not_allowed');
  if (!['exact_fact','market_question','page_question','recommendation'].includes(route)) return fail('route_not_allowed');
  // Explicit project/fact lookups are always allowed to fail closed.
  if (liveOrEntityFact.test(s)) return fail('live_or_entity_fact');
  // Never turn a request to locate, compare, or contact into a concept explanation.
  if (/\b(?:find|show|list|search for|shortlist|book|arrange|contact|call me|send me offers|compare (?:two|these|the following) projects)\b/i.test(s)) return fail('actionable_request');
  const term=extractDefinitionTerm(s);
  if (!term) return fail('not_explicit_definition_question');
  if (term.length < 2 || term.length > 66 || /\d{4}|\d+(?:\.\d+)?\s*%|\b(?:AED|USD|GBP|EUR|million)\b/i.test(term)) return fail('term_out_of_scope');
  if (/[\n{}<>]/.test(term)) return fail('term_unsafe');
  return {eligible:true,reason:'general_concept_definition',term,version:'GeneralConceptDefinitionV1'};
}


// FIX08E — distinguish marketing-price reliability from a live price lookup.
// This function does not authorize searching or asserting a current price.
export function isMarketingPriceReliabilityQuestionV1(message = "") {
  const s = String(message || "")
    .replace(/[’]/g, "'")
    .trim();

  if (!s || s.length > 700) return false;

  const marketingSource =
    /\b(?:brochure|marketing material|advertisement|advert|sales flyer|price list)\b/i.test(s);

  const asksReliability =
    /\b(?:should i treat|can i treat|is it|is that|does that mean|can i assume|should i assume|is the price)\b/i.test(s) &&
    /\b(?:today'?s|current|confirmed|accurate|valid|up.to.date|guaranteed|final)\b/i.test(s);

  const actualPriceRequest =
    /\b(?:what is|give me|tell me|find|show|check|verify|look up)\b[\s\S]{0,90}\b(?:actual|exact|live|current|latest)\s+(?:asking\s+)?price\b/i;

  const executableRequest =
    /\b(?:send me offers|contact me|call me|book a viewing|find apartments|search listings)\b/i.test(s);

  return marketingSource &&
    asksReliability &&
    !executableRequest &&
    !new RegExp(actualPriceRequest.source.replace(/\s+/g, ""), "i").test(s);
}
