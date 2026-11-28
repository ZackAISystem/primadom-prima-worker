import { extractMemoryFacts } from "./memory.js";

/*
 * MEM07: narrow, zero-LLM buyer-profile update gate.
 * This does NOT handle mixed search, advice, compare or contact requests.
 * It only recognizes explicit, English, factual buyer preferences.
 * Other inputs continue to the existing Router / Interpreter unchanged.
 */
const DURATION_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
});

const ACTION_REQUEST =
  /[?]|\b(?:show|find|search|browse|list|compare|recommend|suggest|shortlist|calculate|explain|evaluate|analyze|analyse|tell me|what|which|why|how|can you|could you|please|book|schedule|arrange|viewing|contact|call me|call us|whatsapp|email me|send me|introduce me|connect me|visit the project)\b/i;
const PROPERTY_DISCOVERY =
  /\b(?:looking for|searching for|need to find|want to find|find me|show me|looking at|considering (?:the )?(?:project|property))\b/i;
// Mixed messages with new search criteria must go through the existing
// full extraction/router path; this local gate cannot silently drop them.
const EXTRA_REQUIREMENTS =
  /\b(?:aed|dhs|budget|bedrooms?|apartments?|villas?|townhouses?|penthouses?|studios?|off[- ]?plan|mortgage|handover|payment plan)\b|\b(?:in|near|around)\s+[A-Z][a-z]+/i;
const NEGATION =
  /\b(?:not|don't|do not|never|no longer|instead of|rather than|without)\b/i;

function duration(text = '') {
  const value = String(text).toLowerCase();
  const match = value.match(/\bwithin\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(weeks?|months?|years?)\b/i);
  if (!match) return null;
  const n = DURATION_WORDS[match[1].toLowerCase()] ?? Number(match[1]);
  return Number.isInteger(n) && n >= 1 && n <= 36
    ? `within ${n} ${match[2].toLowerCase()}` : null;
}

export function classifyPureBuyerProfileUpdateV1(message = '', languageCode = 'en') {
  const text = String(message || '').trim().replace(/[’]/g, "'");
  if (!text || text.length > 320 || languageCode !== 'en' ||
      ACTION_REQUEST.test(text) || PROPERTY_DISCOVERY.test(text) ||
      NEGATION.test(text)) return null;

  // PT05/PT09: the buyer's own ceiling is not a Registry price fact.
  // Reuse the canonical extractor, including its existing financing key.
  // "May use a mortgage" is a *tentative* preference (lower confidence),
  // not proof of mortgage approval or a binding financing decision.
  const budgetDeclaration = /^(?:my|our)\s+(?:(?:max(?:imum)?\s+)?(?:purchase\s+)?(?:price|budget)|price\s+ceiling)\s+(?:is|of|=)\s*(?:aed|dhs?|dirhams?)\s*[\d.,]+/i.test(text);
  if (EXTRA_REQUIREMENTS.test(text) && !budgetDeclaration) return null;
  // The narrow fast-path must not discard additional home/location criteria.
  // Such mixed requests continue to the existing full Interpreter pipeline.
  if (budgetDeclaration && /\b(?:bedrooms?|studios?|apartments?|villas?|townhouses?|penthouses?|in\s+[A-Z][a-z]+|near\s+[A-Z][a-z]+)\b/i.test(text)) return null;
  const extracted = budgetDeclaration ? extractMemoryFacts(text) : [];
  const budgetFact = extracted.find(f => f?.fact_key === 'budget_max_aed');
  const facts = budgetFact
    ? [{fact_key:'budget_max_aed', fact_value:budgetFact.fact_value,
        confidence:0.98, source:'mem07_explicit_profile'}] : [];
  const mortgageFact = extracted.find(f =>
    f?.fact_key === 'financing' && f?.fact_value === 'mortgage');
  const personalMortgageCue = /\b(?:i|we)\b[^.!?]{0,75}\b(?:mortgage|finance\s+(?:the\s+)?purchase)\b/i.test(text);
  if (budgetFact && mortgageFact && personalMortgageCue) {
    const tentative = /\b(?:may|might|could|possibly|perhaps|consider(?:ing)?|thinking\s+about|open\s+to)\b[^.!?]{0,50}\b(?:mortgage|financing)\b/i.test(text);
    facts.push({fact_key:'financing',fact_value:'mortgage',
      confidence:tentative ? 0.76 : 0.96,
      source:tentative ? 'mem07_tentative_financing' : 'mem07_explicit_financing'});
  }
  const investing =
    /\b(?:i(?:'m| am)|we(?:'re| are))\s+(?:buying|purchasing|investing)\s+(?:a\s+(?:property|home)\s+)?for\s+investment\b/i.test(text) ||
    /\b(?:my|our)\s+(?:purchase\s+)?goal\s+is\s+(?:an?\s+)?investment\b/i.test(text) ||
    /\b(?:i|we)\s+(?:plan|intend)\s+to\s+buy\s+for\s+investment\b/i.test(text);
  if (investing) facts.push({fact_key:'buyer_goal', fact_value:'investment', confidence:0.97, source:'mem07_explicit_profile'});

  const rentalIncomePriority =
    /\b(?:rental income|rental yield|cash\s*flow)\b[^.!?]{0,60}\b(?:main|primary|top|first|highest|biggest|number one)\s+priority\b/i.test(text) ||
    /\b(?:my|our)\s+(?:(?:main|primary|top|first|highest|biggest)\s+)?priority\s+is\s+(?:rental income|rental yield|cash\s*flow)\b/i.test(text);
  const capitalGrowthPriority =
    /\b(?:capital appreciation|capital growth)\b[^.!?]{0,60}\b(?:main|primary|top|first|highest|biggest)\s+priority\b/i.test(text) ||
    /\b(?:my|our)\s+(?:(?:main|primary|top|first|highest|biggest)\s+)?priority\s+is\s+(?:capital appreciation|capital growth)\b/i.test(text);
  if (rentalIncomePriority !== capitalGrowthPriority) {
    facts.push({fact_key:'investment_priority',
      fact_value:rentalIncomePriority ? 'rental_income' : 'capital_appreciation',
      confidence:0.97, source:'mem07_explicit_profile'});
  }

  const buyingTimeline =
    /\b(?:i|we)\s+(?:plan|intend|hope|want)\s+to\s+(?:buy|purchase|invest)\b[^.!?]{0,65}\bwithin\b/i.test(text) ||
    /\b(?:i(?:'m| am)|we(?:'re| are))\s+planning\s+to\s+(?:buy|purchase|invest)\b[^.!?]{0,65}\bwithin\b/i.test(text) ||
    /\b(?:buy|purchase)\s+within\b/i.test(text);
  const timing = buyingTimeline ? duration(text) : null;
  if (timing) facts.push({fact_key:'timeline', fact_value:timing, confidence:0.96, source:'mem07_explicit_profile'});

  if (facts.length === 0) return null;
  // When two different investment priorities are asserted, avoid guessing.
  if (rentalIncomePriority && capitalGrowthPriority) return null;
  return {version:'PureBuyerProfileUpdateV1', facts};
}

function memoryValue(facts, key) {
  return [...(Array.isArray(facts) ? facts : [])].reverse()
    .find(f => f?.fact_key === key)?.fact_value ?? null;
}

export function buildBuyerProfileAcknowledgementV1(facts = [], memory = []) {
  const name = memoryValue(memory, 'user_name');
  const prefix = typeof name === 'string' && /^[\p{L}' -]{1,40}$/u.test(name)
    ? `Got it, ${name}. ` : 'Got it. ';
  const goal = memoryValue(facts, 'buyer_goal');
  const priority = memoryValue(facts, 'investment_priority');
  const timeline = memoryValue(facts, 'timeline');
  const details = [];
  if (goal === 'investment') details.push("You're buying for investment");
  if (priority === 'rental_income') details.push('rental income is your priority');
  if (priority === 'capital_appreciation') details.push('capital appreciation is your priority');
  if (typeof timeline === 'string') details.push(`you plan to buy ${timeline}`);
  let answer = details.length
    ? prefix + details.join('; ') + '.'
    : prefix + "I'll keep your updated purchase preferences in mind.";
  const property = memoryValue(memory, 'property_type');
  const bedrooms = Number(memoryValue(memory, 'bedrooms'));
  const location = memoryValue(memory, 'preferred_location_text');
  const budget = Number(memoryValue(memory, 'budget_max_aed'));
  const home = [];
  if (Number.isInteger(bedrooms) && bedrooms >= 1 && bedrooms <= 20) home.push(`${bedrooms}-bedroom`);
  if (typeof property === 'string' && /^(apartment|villa|townhouse|penthouse|duplex|studio|plot)$/i.test(property)) home.push(property);
  if (typeof location === 'string' && location.length <= 70 && !/[\r\n]/.test(location)) home.push(`in ${location}`);
  const prefs = [];
  if (home.length) prefs.push(`${home.join(' ')} preference`);
  if (Number.isFinite(budget) && budget > 0 && budget <= 1e10)
    prefs.push(`maximum purchase budget of AED ${budget.toLocaleString('en-US')}`);
  const finance = [...(Array.isArray(memory) ? memory : [])].reverse()
    .find(f => f?.fact_key === 'financing');
  if (finance?.fact_value === 'mortgage') {
    prefs.push(Number(finance.confidence) < 0.9
      ? 'mortgage as a possible financing option (not confirmed)'
      : 'mortgage financing preference');
  }
  if (prefs.length) answer += ` Your current preferences: ${prefs.join('; ')}.`;
  return answer;
}
