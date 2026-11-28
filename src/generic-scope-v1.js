// FIX06A — Generic Scope V1.
// Semantic scope guards only.
// Does not authorize Search, Contact or unverified facts.

export function isGenericProjectCriteriaComparisonV1(message = "") {
  const text = String(message || "").trim();
  if (!text || text.length > 1000) return false;

  const comparative =
    /\b(?:compare|comparing|comparison)\b/i.test(text);

  const hypothetical =
    /\b(?:when one|if one|one has|one offers|one requires)\b/i.test(text);

  const genericProjects =
    /\b(?:two|2)\s+(?:off[ -]plan\s+)?projects?\b/i.test(text);

  const verifiedFact =
    /\b(?:exact|live|current|verified|official)\s+(?:price|availability|handover date)\b/i.test(text);

  return comparative && hypothetical && genericProjects && !verifiedFact;
}

export function isBudgetCriterionDefinitionV1(message = "") {
  const text = String(message || "").trim();
  if (!text || text.length > 1000) return false;

  return /\b(?:what does|what is the meaning of|explain|define)\b/i.test(text) &&
    /\bAED\s*[\d,.]+\s*(?:m|million|k|thousand)?\s*(?:maximum|max|limit|cap)\b/i.test(text) &&
    /\b(?:search criterion|search criteria|search filter|budget criterion|budget limit)\b/i.test(text);
}

export function isGenericScopeEntityV1({
  message = "",
  entityName = "",
  action = null
} = {}) {
  const name = String(entityName || "").trim();

  if (
    action === "COMPARE" &&
    isGenericProjectCriteriaComparisonV1(message) &&
    /^off[ -]?plan$/i.test(name)
  ) return true;

  if (
    ["ADVISORY", "KNOWLEDGE_QA"].includes(action) &&
    isBudgetCriterionDefinitionV1(message) &&
    /^AED\s*[\d,.]+\s*(?:m|million|k|thousand)?\s*(?:maximum|max|limit|cap)$/i.test(name)
  ) return true;

  return false;
}
