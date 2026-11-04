/*
 * Search Turn Understanding V1 (EN)
 *
 * A small, pure coordination layer between SearchContextV1,
 * RequestInterpreterV1 and Prima Search. No database calls, rankings,
 * model invocation, contact operations or new Search implementation.
 *
 * A verified SearchContext supplies previously known facts. Luna may
 * classify the current request and propose changed slots; it never
 * invents catalog facts or executes a search.
 */

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const normalizeName = value => String(value || "")
  .toLowerCase().replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const niceName = value => String(value || "").trim()
  .replace(/-/g, " ").replace(/\s+/g, " ");

function searchSnapshot(context) {
  const search = context?.search;
  if (search?.version === "SearchContextV1" && search.language === "en" &&
      search.entity_type === "project" &&
      ["results", "empty"].includes(search.state)) return search;
  return null;
}

function hasSavedSearch(context) {
  const snapshot = searchSnapshot(context);
  const saved = context?.conversation?.dialogue_state
    ?.continuity_references?.active_search_context;
  return Boolean(snapshot || (saved?.state === "results" &&
    Number(saved?.result_count) > 0));
}

function contextualSearchReference(message) {
  return /\b(?:that|this|same|previous|earlier|last|those|these)\s+(?:area|district|community|neighbou?rhood|developer|builder|location|search|results?|projects?|properties|options)\b/i.test(message) ||
    /\b(?:my|our)\s+(?:original|previous|earlier|last|existing|current)\s+(?:budget|search|filters?|criteria|requirements?|preferences?)\b/i.test(message);
}

function isSearchRecall(message) {
  return /\b(?:remind\s+me|recap|recall|remember|what\s+(?:was|were|are|is)\s+(?:my|our)|what\s+(?:did|have)\s+(?:i|we))\b/i.test(message) &&
    /\b(?:search|look(?:ing)?\s+for|filter|criteria|budget|location|area|district|bedrooms?|property\s+type|requirements?|status|preferences?)\b/i.test(message) &&
    !/\b(?:find|show|search\s+for|list|browse)\s+(?:me\s+)?(?:new|more|other|additional|projects?|apartments?|properties?)\b/i.test(message);
}

function isSearchRefinement(message) {
  // A budget operator like "up to" can appear in a wholly NEW search.
  // Do not inherit a previous developer/location merely because both
  // queries mention money.
  const change = /\b(?:only\s+want|instead|keep|retain|leave|same|original|previous|refine|change|adjust|modify|update|increase|raise|lower|decrease|reduce|switch|extend|narrow|widen)\b/i.test(message);
  const field = /\b(?:budget|price|aed|dhs|bedrooms?|beds?|apartments?|villas?|townhouses?|penthouses?|property\s+types?|location|district|area|developer|off[- ]?plan|ready|handover|filters?|criteria|search)\b/i.test(message);
  return change && field;
}

export function classifySearchTurnV1({message = "", route = null, context = null} = {}) {
  const text = String(message || "").trim();
  if (!text || context?.turn?.phase === "tool_continuation" ||
      context?.page?.language_code && context.page.language_code !== "en") return null;
  const hasSearch = hasSavedSearch(context);
  if (hasSearch && isSearchRecall(text)) return "recall";
  if (hasSearch && isSearchRefinement(text) &&
      !/\b(?:contact|call\s+me|book\s+a\s+viewing|whatsapp)\b/i.test(text)) return "refinement";
  if (route === "property_search" && contextualSearchReference(text)) {
    return "contextual_search";
  }
  // Generic questions about a named developer are a knowledge task, not
  // the founder's Emaar employment history or an exact developer field.
  if (["exact_fact", "page_question", "market_question"].includes(route) &&
      /\bdevelopers?\b/i.test(text) &&
      /\b(?:tell|explain|describe|understand|overview|buyer|choos|risks?|reputation|track\s+record)\b/i.test(text) &&
      !/\b(?:who\s+(?:is|was)\s+the\s+developer|which\s+developer\s+(?:built|developed))\b/i.test(text)) {
    return "entity_knowledge";
  }
  return null;
}

export function resolveOrdinalSearchPairV1({message = "", route = "", context = null} = {}) {
  const search = searchSnapshot(context);
  if (route !== "compare" || search?.state !== "results" ||
      !Array.isArray(search.results)) return null;
  const text = String(message || "");
  if (!/\b(?:compare|comparison|difference|versus|vs\.?|which\s+(?:is|would\s+be)\s+better)\b/i.test(text)) return null;
  const found = [...text.matchAll(/\b(first|second|third|1st|2nd|3rd)\b/gi)]
    .map(m => ({first:0, "1st":0, second:1, "2nd":1, third:2, "3rd":2})[m[1].toLowerCase()]);
  if (found.length !== 2 || found[0] === found[1]) return null;
  const offset = Number.isInteger(search.current_batch_offset)
    ? search.current_batch_offset : 0;
  const results = found.map(i => search.results[offset + i]);
  if (results.some(r => r?.entity_type !== "project" ||
      !SAFE_SLUG.test(r?.slug || "") ||
      r?.canonical_url !== `/en/projects/${r.slug}/`)) return null;
  return {
    first: {type:"project", slug:results[0].slug, name:results[0].title || niceName(results[0].slug)},
    second: {type:"project", slug:results[1].slug, name:results[1].title || niceName(results[1].slug)}
  };
}

export function buildSearchRecallV1({message = "", context = null} = {}) {
  if (classifySearchTurnV1({message, route:"follow_up", context}) !== "recall") return null;
  const search = searchSnapshot(context);
  const state = context?.conversation?.dialogue_state?.request_state || {};
  const filters = search?.filters || {};
  const location = filters.district || state.location || null;
  const developer = filters.developer || null;
  const types = Array.isArray(filters.property_types) && filters.property_types.length
    ? filters.property_types : state.property_type ? [state.property_type] : [];
  const beds = Array.isArray(filters.bedrooms) && filters.bedrooms.length
    ? filters.bedrooms : state.bedrooms != null ? [state.bedrooms] : [];
  const max = Number(filters?.budget?.max || state?.budget?.max_aed || 0);
  const isOffPlan = /\boff[- ]?plan\b/i.test(search?.query || "");
  const hasReady = /\bready(?:\s+properties)?\b/i.test(search?.query || "") && !isOffPlan;
  const values = [];
  if (location) values.push(`location: ${niceName(location)}`);
  if (developer) values.push(`developer: ${niceName(developer)}`);
  if (types.length) values.push(`property type: ${types.join(", ")}`);
  if (beds.length) values.push(`bedrooms: ${beds.join(", ")}`);
  if (Number.isFinite(max) && max > 0) values.push(`maximum budget: AED ${max.toLocaleString("en-US")}`);
  if (isOffPlan) values.push("status: off-plan");
  if (hasReady) values.push("status: ready");
  return values.length
    ? {version:"SearchTurnRecallV1",action:"REFERENCE",
       answer:`From your last search, I have ${values.join("; ")}. I won't assume any other filters.`}
    : null;
}

function groundedInTurnOrHistory(value, message, context) {
  const name = normalizeName(value);
  if (!name || name.length < 3 || name.length > 90) return false;
  const turns = (context?.conversation?.recent_messages || [])
    .filter(item => item?.role === "user").slice(-6)
    .map(item => String(item.content || ""));
  const source = normalizeName([message, ...turns].join(" "));
  return (" " + source + " ").includes(" " + name + " ");
}

export function contextualSearchQueryV1({message = "", context = null} = {}) {
  const type = classifySearchTurnV1({message,route:"property_search",context});
  if (!["refinement", "contextual_search"].includes(type)) return null;
  const interp = context?.request_interpretation;
  if (interp?.version !== "RequestInterpreterV1" ||
      interp.primary_route !== "property_search" ||
      Number(interp.overall_confidence) < 0.65) return null;

  const fields = interp.constraints || {};
  const last = searchSnapshot(context);
  const saved = context?.conversation?.dialogue_state?.request_state || {};
  const inherit = type === "refinement";
  const filters = inherit ? last?.filters || {} : {};
  const fromModel = (field, fallback) => {
    const candidate = typeof field === "string" ? field.trim() : field;
    return candidate !== "" && candidate !== null && candidate !== undefined
      ? candidate : fallback;
  };
  const locationCandidate = fromModel(fields.location,
    inherit ? filters.district || saved.location : null);
  const location = locationCandidate &&
    (filters.district && normalizeName(locationCandidate) === normalizeName(filters.district) ||
      groundedInTurnOrHistory(locationCandidate, message, context))
    ? niceName(locationCandidate) : null;
  const developerCandidate = fromModel(fields.developer,
    inherit ? filters.developer : null);
  const developer = developerCandidate &&
    (filters.developer && normalizeName(developerCandidate) === normalizeName(filters.developer) ||
      groundedInTurnOrHistory(developerCandidate, message, context))
    ? niceName(developerCandidate) : null;
  const parsedBedrooms = fromModel(fields.bedrooms,
    inherit ? (filters.bedrooms?.[0] ?? saved.bedrooms) : null);
  const bedrooms = parsedBedrooms !== null && parsedBedrooms !== undefined &&
    Number.isInteger(Number(parsedBedrooms)) && Number(parsedBedrooms) >= 0 && Number(parsedBedrooms) <= 10
      ? Number(parsedBedrooms) : null;
  const rawType = fromModel(fields.property_type,
    inherit ? (filters.property_types?.[0] || saved.property_type) : null);
  const propertyType = /^(?:apartment|villa|townhouse|penthouse|duplex|studio|plot)s?$/i
    .test(String(rawType || "")) ? String(rawType).trim() : null;
  const rawBudget = fromModel(fields.budget_max_aed,
    inherit ? (filters?.budget?.max ?? saved?.budget?.max_aed) : null);
  const max = Number(rawBudget);
  const budgetMax = Number.isSafeInteger(max) && max >= 10000 && max <= 10_000_000_000
    ? max : null;
  const explicitOffPlan = /\boff[- ]?plan\b/i.test(message);
  const explicitReady = /\bready\b/i.test(message);
  const priorOffPlan = inherit && /\boff[- ]?plan\b/i.test(last?.query || "");
  const priorReady = inherit && /\bready\b/i.test(last?.query || "") && !priorOffPlan;
  const parts = ["Find"];
  if (explicitOffPlan || (priorOffPlan && !explicitReady)) parts.push("off-plan");
  else if (explicitReady || priorReady) parts.push("ready");
  if (bedrooms !== null) parts.push(`${bedrooms}-bedroom`);
  parts.push(propertyType ? `${propertyType.replace(/s$/i, "")}s` : "projects");
  if (developer) parts.push(`by ${developer}`);
  if (location) parts.push(`in ${location}`);
  if (budgetMax !== null) parts.push(`under AED ${budgetMax}`);
  // Never broaden a referential location search into unbounded UAE results.
  if (type === "contextual_search" &&
      /\b(?:that|this|same|previous|last)\s+(?:area|district|community|neighbou?rhood|developer|builder)\b/i.test(message) &&
      !location && !developer) return null;
  return parts.length > 2 ? parts.join(" ") : null;
}
