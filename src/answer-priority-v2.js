/*
  PRIMA ANSWER PRIORITY V2 — final answer ownership, not a second Router.
  Existing Luna/DecisionPolicy, Search, Contact and evidence permissions
  remain unchanged. This module cannot authorize user contact or live claims.
*/

export function shouldDeferMarketFallbackToComposerV2({
  route = null,
  action = null
} = {}) {
  return route === "market_question" &&
    (action === "KNOWLEDGE_QA" || action === "ADVISORY");
}

// Preserve a clearly separate WH-question even when the user also refuses
// contact. Refusal is still written to state by the original P0 Funnel path.
// An opt-out alone, or a short confirmation like "okay?", is not another task.
export function hasIndependentInformationalQuestionV2(message = "") {
  const text = String(message || "").replaceAll("’", "'").trim();
  if (!text.includes("?")) return false;
  // Do not treat an imperative inside a quoted sales message as this user's task.
  const outsideQuotes = text.replace(/(["“‘'])[^"”’']{1,240}["”’']/gu, " ");
  return /(?:^|[.!?;,]\s*|\b(?:but|and)\s+)(?:(?:what|which|how|why|where|when|who)\b|(?:do|does|is|are)\s+\w+|(?:could|would|can|will)\s+(?:you|we|i)\s+(?:(?:please|still|also)\s+){0,3}(?:help (?:me|us) (?:plan|compare|evaluate)|explain|describe|compare|outline|summarize|clarify|tell|walk|discuss|evaluate|ask|plan|research)\b)[^?!\n]{1,300}\?/iu
    .test(outsideQuotes);
}

// A Funnel refusal acknowledgement can be stored without replacing the
// answer to a separate question. Do not change contact permission or memory.
// FIX04A — a separate informational imperative has answer ownership even
// without a question mark. This never grants permission to contact anyone.
export function hasIndependentInformationalImperativeV4(message = "") {
  const text = String(message || "").replaceAll("’", "'").trim();
  if (!text || text.length > 1000) return false;
  // A task can follow an opt-out clause rather than begin the entire turn.
  // Keep the refusal as state; identify the separate user instruction.
  // Constrain to sentence/clause starts, not arbitrary verbs in quotations.
  const outsideQuotes = text.replace(/(["“‘'])[^"”’']{1,240}["”’']/gu, " ");
  return /(?:^|[.!?;]\s+|,\s*(?:but|and)\s+|\b(?:but|instead)\s+)(?:please\s+)?(?:explain|define|describe|compare|summari[sz]e|(?:keep|continue|resume)\s+compar(?:ing|isons?)|outline|clarify|walk me through|tell me about|answer my question about|answer the question about|show me how|help me (?:evaluate|plan|understand)|discuss (?:general|the)|assess (?:the|how))\b/i.test(outsideQuotes);
}

export function shouldPrioritizeIndependentAnswerOverFunnelV2({
  hasOtherTask = false,
  consent = false,
  action = null,
  decision = null
} = {}) {
  if (!hasOtherTask || consent || !decision?.answer_override ||
      decision?.lead_action ||
      !["KNOWLEDGE_QA", "ADVISORY", "EXACT_FACT", "COMPARE"].includes(action)) return false;
  // Only release the opt-out acknowledgement, never an unrelated Funnel
  // answer. Keeping this ownership check protects existing handoff behavior.
  const isOptOutAck = Array.isArray(decision.memory_facts) &&
    decision.memory_facts.some(fact => fact?.fact_key === "funnel_state" &&
      fact?.fact_value?.status === "contact_opted_out");
  if (!isOptOutAck) return false;
  // The independent task, existing consent gate, and prohibition on lead
  // actions are the authorization boundaries. A Funnel state shape is not
  // proof that a distinct question should be discarded. Preserve all memory
  // facts and follow-up metadata; only release answer ownership.
  return true;
}

// PT06 — A direct restriction on being offered adviser outreach is not
// permission for CONTACT. Quoted examples are not the user's instructions.
// This is read-only; the existing consent gate still owns authorization.
export function isIndependentNoContactConstraintV6(message = "") {
  const text = String(message || "").replaceAll("’", "'").trim();
  if (!text || text.length > 1200) return false;
  const outsideQuotes = text.replace(/(["“‘'])[^"”’']{1,240}["”’']/gu, " ");
  return /\bi\s+(?:do\s+not|don't|dont)\s+want\s+to\s+(?:speak|talk)\s+(?:with|to)\s+(?:(?:an?|the|your)\s+)?(?:agent|advisor|adviser|broker|specialist)\b|\bwithout\s+(?:offering|suggesting|arranging)\s+(?:to\s+)?(?:contact|call|connect|message)\s+me\b/i.test(outsideQuotes);
}

// PT06 — A continuation of a *known conceptual comparison* remains an
// independent answer task after contact opt-out. Never convert the user's
// refusal into Search, lead authorization, or a guessed project comparison.
export function isContextualComparisonContinuationV6({
  message = "", route = null, action = null, context = null
} = {}) {
  if (route !== "compare" || action !== "COMPARE") return false;
  const text = String(message || "").replaceAll("’", "'").trim();
  if (!text || text.length > 1200 ||
      !/\b(?:keep|continue|resume)\s+compar(?:ing|isons?)\b/i.test(text) ||
      /\b(?:exact|current price|availability|service charge|specific unit|registration number)\b/i.test(text)) return false;
  const history = Array.isArray(context?.conversation?.recent_messages)
    ? context.conversation.recent_messages.slice(-12) : [];
  return history.some(item => {
    if (item?.role !== "user") return false;
    const prior = String(item?.content || "").replaceAll("’", "'");
    return (/\b(?:compare|comparing|comparison)\b.{0,100}\b(?:buying|renting|owning|leasehold|freehold)\b/i.test(prior) ||
      /\b(?:buying|renting|owning|leasehold|freehold)\b.{0,55}\b(?:versus|vs\.?|or|and|with)\b.{0,55}\b(?:buying|renting|owning|leasehold|freehold)\b/i.test(prior));
  });
}

// R2.3: A numeric budget is a filter/constraint, not the name of a project.
// This guard is deliberately limited to questions about purchase transaction
// costs, and never authorizes property search or contact.
export function isBudgetPurchaseCostQuestionV23(message = "") {
  const s = String(message || "").replaceAll("’", "'");
  const asksCosts = /\b(?:fees?|closing costs?|transaction costs?|transfer costs?|purchase costs?|extra costs?|registration charges?|stamp duty)\b/i.test(s);
  const budget = /\b(?:AED|Dhs?\.?|dirhams?)\s*[\d,.]+\s*(?:m(?:illion)?|k|thousand)?\b/i.test(s);
  const asksExplanation = /\b(?:how much|what|explain|estimate|reserve|allow for|budget for)\b/i.test(s);
  const forbidsSearch = /\b(?:not (?:asking|looking) (?:you )?to search|do not search|don't search|no listings|without searching)\b/i.test(s);
  return asksCosts && budget && asksExplanation && forbidsSearch;
}

// A no-contact request followed by 'what should I research first?' is two
// tasks. Do not replace the independent advisory task with a Funnel acknowledgement.
export function buildOptOutResearchAnswerV23(message = "", { consent = false } = {}) {
  const s = String(message || "").replaceAll("’", "'");
  if (consent || !/\b(?:no|not|don't|do not|without)\b/i.test(s) ||
      !/\b(?:calls?|messages?|contact|agent|advisor|specialist)\b/i.test(s) ||
      !/\b(?:what|which|how|where)\b[^?\n]{0,95}\b(?:research|review|check|study|compare)\b[^?\n]{0,65}\?/i.test(s)) return null;
  return "You can research independently before speaking with anyone. Start with your total purchase budget and extra fees, then compare neighbourhoods, commuting times, schools or amenities, developer track record, handover dates and payment plans. For investment purchases, compare potential rent, service charges, vacancy risk and resale liquidity. Verify project-specific details against current official documents; I won't arrange a call or message you unless you explicitly ask.";
}


// FIX08A — Contact refusal + independent knowledge ownership.
// This classifier grants no permission for Contact or Search.
export function classifyOptOutIndependentKnowledgeV8(message = "") {
  const text = String(message || "")
    .replaceAll("’", "'")
    .trim();

  if (!text || text.length > 1200) return null;

  const refusal =
    /\b(?:no calls|no contact|no (?:leads?|messages?|phone calls?)|(?:don't|do not) (?:call|message|contact) me|not agreed to anything|haven't agreed to anything|have not agreed to anything|not giving (?:you )?(?:contact )?permission|without (?:contact|calls|messages))\b/i
      .test(text);

  if (!refusal) return null;

  const comparisonQuestion =
    /\b(?:why|how)\s+should\s+i\s+compare\s+(?:different\s+)?(?:property\s+)?projects?\b/i
      .test(text);

  // Conceptual comparisons are answer tasks, not named-project lookups.
  // Do not infer or authorize any Search or Contact action here.
  const conceptualComparison =
    /\bcompare\s+(?:the\s+)?(?:pros?\s+and\s+cons?\s+of\s+)?(?:buying|owning|renting|leasehold|freehold)\s+(?:and|with|versus|vs\.?|to)\s+(?:buying|owning|renting|leasehold|freehold)\b/i.test(text);
  if (comparisonQuestion || conceptualComparison) return "COMPARE";

  const registrationExplanation =
    /\b(?:explain|describe|outline)\s+(?:the\s+)?(?:purchase\s+)?registration\b/i
      .test(text);

  if (registrationExplanation) return "KNOWLEDGE_QA";

  return null;
}

// FIX01 V3 — semantic comparisons are not requests to identify a Registry page.
// This classifier only releases answer ownership. It grants no Search, Contact,
// live market fact, property identity, or verified project claim permission.
export function isConceptualBuyerComparisonFix01V3({
  message = "", route = null, interpretation = null
} = {}) {
  if (route !== "compare") return false;
  const text = String(message || "").trim();
  if (!text || text.length > 1200) return false;
  if (/\b(?:exact|verified|official|live|latest|current (?:price|availability)|specific (?:project|unit|price)|registration number|certificate number|title deed for|handover date|unit number)\b/i.test(text)) return false;
  const entities = Array.isArray(interpretation?.entities) ? interpretation.entities : [];
  if (entities.some(e => ["project", "developer"].includes(String(e?.type || "").toLowerCase()))) return false;
  const buyingRenting = /\b(?:buy(?:ing)?|own(?:ing)?)\s+(?:versus|vs\.?|or|compared (?:to|with))\s+rent(?:ing)?\b|\brent(?:ing)?\s+(?:versus|vs\.?|or|compared (?:to|with))\s+buy(?:ing)?\b/i.test(text);
  const timingAdvice = /\b(?:departure|moving|move(?: out)?|leav(?:e|ing)|relocat(?:e|ion|ing))\b/i.test(text) && /\b(?:timing|recommendation|buy(?:ing)?|rent(?:ing)?|trade-?offs?|choice|decision|affect)\b/i.test(text);
  const continuation = /\b(?:keep|continue|go back to)\s+(?:the\s+)?compar(?:ing|e|ison)\b/i.test(text);
  return buyingRenting || timingAdvice || continuation;
}
