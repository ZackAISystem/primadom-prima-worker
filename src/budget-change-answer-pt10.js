/*
 * PT10: the buyer's own changed budget is conversation state, not a live
 * property fact. This helper owns wording only; it never writes Memory,
 * changes policy, authorizes a search, or checks market prices.
 */
function maxBudget(facts) {
  if (!Array.isArray(facts)) return null;
  for (let i = facts.length - 1; i >= 0; i--) {
    if (facts[i]?.fact_key !== 'budget_max_aed') continue;
    const n = Number(facts[i]?.fact_value);
    if (Number.isSafeInteger(n) && n >= 100000 && n <= 10000000000) return n;
  }
  return null;
}

export function recoverBudgetChangeAnswerPT10({
  message = '', language = 'en', priorFacts = [], currentFacts = [],
  action = null, authorizedContact = false, searchPending = false
} = {}) {
  const text = String(message || '').trim().replace(/[’]/g, "'");
  if (language !== 'en' || !text || text.length > 360 ||
      authorizedContact || searchPending ||
      ['SEARCH','PAGE_MORE','RESUME_SEARCH','CONTACT','CONTACT_HANDOFF'].includes(action)) return null;
  // This is NOT a general 'AED amount' parser or a hypothetical market-price
  // answer. Require the explicit *current-turn* budget fact and a prior fact.
  const changeCue = /\b(?:if|when)\s+(?:i|we)\s+(?:change|raise|lower|update|adjust|move)\b[^?\n]{0,100}\b(?:ceiling|limit|budget|maximum|cap)\b/i.test(text) ||
    /\b(?:i|we)(?:'d| would| want to| am going to| are going to)?\s+(?:change|raise|lower|update|adjust)\s+(?:my|our|the)\s+(?:ceiling|limit|budget|maximum|cap)\b/i.test(text);
  const oldLimitQuestion = /\b(?:earlier|previous|old|prior)\s+(?:limit|ceiling|budget|maximum)\b|\b(?:what happens|supersed(?:e|es)|replac(?:e|es)|still apply)\b/i.test(text);
  if (!changeCue || !oldLimitQuestion || /\b(?:hypothetically|for example|just an example|not actually changing|don't change|do not change)\b/i.test(text)) return null;
  const previous = maxBudget(priorFacts);
  const newMax = maxBudget(currentFacts);
  if (previous === null || newMax === null || previous === newMax) return null;
  const aed = value => `AED ${value.toLocaleString('en-US')}`;
  return {
    kind:'budget_change',
    answer:`Your earlier purchase-price ceiling was ${aed(previous)}. Your newly stated ceiling of ${aed(newMax)} supersedes that earlier limit for our discussion. I'll use ${aed(newMax)} as your current maximum; this is your own budget preference, not a verified property price.`
  };
}
