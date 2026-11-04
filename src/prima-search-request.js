import { normalizePreferredLocationTextV1 } from "./preferred-location-v1.js";
import { classifySearchTurnV1, contextualSearchQueryV1 } from "./search-turn-understanding.js";
function humanizeSlug(
  value = ""
) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map(
      part =>
        part.charAt(0).toUpperCase() +
        part.slice(1)
    )
    .join(" ");
}


function completedSearchContext(
  context
) {
  const search =
    context?.search;

  if (
    search?.version !==
      "SearchContextV1" ||
    search?.language !== "en" ||
    search?.entity_type !==
      "project"
  ) {
    return false;
  }

  /*
    Both "results" and "empty" mean that
    Prima Search already executed.

    Empty results must NOT trigger an
    endless Search request loop.
  */
  return (
    search.state === "results" ||
    search.state === "empty"
  );
}


function contextualSearchQuery({
  message = "",
  context = null
} = {}) {
  let query =
    String(message || "")
      .trim();

  const entityType =
    context
      ?.entity
      ?.primary_type;

  const entitySlug =
    context
      ?.entity
      ?.primary_slug;

  if (
    entityType !== "project" ||
    !entitySlug
  ) {
    return query;
  }

  const projectName =
    humanizeSlug(
      entitySlug
    );

  /*
    Resolve simple current-project references
    before handing the query to the existing
    deterministic Project Search.

    Search itself remains unchanged.
  */
  query = query.replace(
    /\b(this one|this project|this property)\b/gi,
    projectName
  );

  /*
    On a Project page:
    "Show me something similar below AED 5M"
    becomes:
    "Show me something similar to this project below AED 5M"

    This is context resolution, not Search ranking.
  */
  if (
    /\bsimilar\b/i.test(query) &&
    !/\bsimilar\s+to\b/i.test(query)
  ) {
    query = query.replace(
      /\bsimilar\b/i,
      `similar to ${projectName}`
    );
  }

  /*
    Same principle for:
    "show me something cheaper"
    on a resolved Project page.
  */
  if (
    /\bcheaper\b/i.test(query) &&
    !/\bcheaper\s+than\b/i.test(query)
  ) {
    query = query.replace(
      /\bcheaper\b/i,
      `cheaper than ${projectName}`
    );
  }

  return query;
}


function memoryValue(
  context,
  key
) {
  const facts =
    context
      ?.memory
      ?.active_facts;

  if (!Array.isArray(facts)) {
    return null;
  }

  for (
    let i = facts.length - 1;
    i >= 0;
    i--
  ) {
    if (
      facts[i]?.fact_key === key
    ) {
      return facts[i].fact_value;
    }
  }

  return null;
}


function recommendationNeedsSearch({
  message = "",
  context = null
} = {}) {
  const q =
    String(message || "")
      .trim()
      .toLowerCase();

  if (!q) {
    return false;
  }

  // Area advice is Knowledge, not Project Search.
  if (
    /\b(?:which|what)\s+(?:area|district|community)\b/i
      .test(q)
  ) {
    return false;
  }

  // Explicit request for alternatives = discovery.
  if (
    /\b(alternatives?|other options?|something else|another project|another property)\b/i
      .test(q)
  ) {
    return true;
  }

  if (
    /\b(?:which|what)\s+(?:project|property|apartment|villa|townhouse|penthouse)s?\b/i
      .test(q) ||
    /\b(?:recommend|suggest)\b[\s\S]{0,80}\b(?:project|property|apartment|villa|townhouse|penthouse)s?\b/i
      .test(q)
  ) {
    return true;
  }

  const currentProject =
    context
      ?.entity
      ?.primary_type === "project" &&
    Boolean(
      context
        ?.entity
        ?.primary_slug
    );

  // "Would you recommend this project?"
  // stays on the current-project Knowledge path.
  if (currentProject) {
    return false;
  }

  return (
    /\b(best for me|best for us|what suits|suitable for me|suitable for us|recommend|suggest)\b/i
      .test(q)
  );
}


function augmentSearchQueryWithMemory({
  query = "",
  context = null,
  explicitMaxBudgetAed = null
} = {}) {
  const base =
    String(query || "").trim();

  const parts = [base];
  const q = base.toLowerCase();

  const rawBedrooms =
    memoryValue(
      context,
      "bedrooms"
    );

  const bedrooms =
    rawBedrooms === null ||
    rawBedrooms === "" ||
    typeof rawBedrooms === "undefined"
      ? null
      : Number(rawBedrooms);

  if (
    bedrooms !== null &&
    Number.isInteger(bedrooms) &&
    bedrooms >= 0 &&
    bedrooms <= 20 &&
    !/\b\d+\s*(?:br|bed|beds|bedroom|bedrooms)\b/i
      .test(q)
  ) {
    parts.push(
      `${bedrooms} bedroom`
    );
  }

  const propertyType =
    memoryValue(
      context,
      "property_type"
    );

  if (
    typeof propertyType === "string" &&
    propertyType.trim() &&
    !/\b(studio|apartment|villa|townhouse|penthouse|duplex|plot)\b/i
      .test(q)
  ) {
    parts.push(
      propertyType.trim()
    );
  }

  const location = normalizePreferredLocationTextV1(
    memoryValue(context, "preferred_location_text")
  );

  if (
    location &&
    !/\b(?:in|at|near|around)\s+[a-z0-9]/i
      .test(q)
  ) {
    parts.push(
      `in ${location.trim()}`
    );
  }

  const budgetMax =
    explicitMaxBudgetAed !== null
      ? Number(explicitMaxBudgetAed)
      : Number(
          memoryValue(
            context,
            "budget_max_aed"
          )
        );

  if (
    Number.isFinite(budgetMax) &&
    budgetMax > 0 &&
    !(
      /\baed\b/i.test(q) ||
      /\b\d+(?:\.\d+)?\s*(?:m|million|k|thousand)\b/i
        .test(q)
    )
  ) {
    parts.push(
      `under AED ${Math.round(
        budgetMax
      )}`
    );
  }

  const buyerGoal =
    memoryValue(
      context,
      "buyer_goal"
    );

  if (
    buyerGoal === "investment" &&
    !/\binvest/i.test(q)
  ) {
    parts.push("investment");
  }

  const lifestyle =
    memoryValue(
      context,
      "lifestyle_preferences"
    );

  if (
    Array.isArray(lifestyle) &&
    lifestyle.includes("waterfront") &&
    !/\bwaterfront\b/i.test(q)
  ) {
    parts.push("waterfront");
  }

  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}


/*
  MEM06 — Explicit max-budget refinement at the Prima→Search boundary.

  The existing Search V3 parser can interpret conversational phrasing
  such as "increase my maximum budget to AED 5 million" as "around
  AED 5 million". For an explicit continuation that leaves all other
  criteria unchanged, send the deterministic Search parser a canonical
  upper-bound query instead. Preserve the original user message for
  Memory extraction; only the outbound Search query changes.

  Intentionally narrow: never reinterpret "around", "between", a new
  area, a new property type, or an unrelated named-project request.
*/
function explicitMaxBudgetContinuation({
  message = "",
  context = null
} = {}) {
  const text = String(message || "").trim();

  const sameOtherCriteria =
    /\b(?:everything\s+else|all\s+else|everything|the\s+rest)\s+(?:stays?|remains?|is)\s+(?:the\s+)?same\b/i.test(text) ||
    /\b(?:keep|leave)\s+(?:everything\s+else|all\s+else|everything|the\s+rest)\s+(?:the\s+)?same\b/i.test(text) ||
    /\b(?:no other changes|other criteria unchanged)\b/i.test(text);

  if (!sameOtherCriteria) {
    return null;
  }

  // Do not silently erase another new criterion from a mixed message.
  if (
    /\b\d+\s*[- ]?\s*(?:br|bed|beds|bedroom|bedrooms)\b/i.test(text) ||
    /\b(?:apartment|villa|townhouse|penthouse|duplex|studio|plot)s?\b/i.test(text) ||
    /\b(?:move|switch|change)\s+(?:the\s+)?(?:area|district|location)\b/i.test(text)
  ) {
    return null;
  }

  // An explicit upper limit — not merely "my budget is around 5M".
  const matched = text.match(
    /\b(?:increase|raise|lower|reduce|change|adjust|update|set)\s+(?:my|our|the)\s+(?:maximum|max)\s+budget\s+(?:to|at)\s*(?:(?:AED|DHS?|DH)\s*)?([\d,]+(?:\.\d+)?)\s*(millions?|m|thousands?|k)?\b/i
  );

  if (!matched) {
    return null;
  }

  const raw = Number(matched[1].replace(/,/g, ""));
  const unit = String(matched[2] || "").toLowerCase();
  const multiplier =
    unit.startsWith("million") || unit === "m"
      ? 1_000_000
      : unit.startsWith("thousand") || unit === "k"
        ? 1_000
        : 1;
  const maxAed = raw * multiplier;

  if (
    !Number.isSafeInteger(maxAed) ||
    maxAed < 10_000 ||
    maxAed > 10_000_000_000
  ) {
    return null;
  }

  /*
    MEM08 — A deterministic continuation must preserve the last verified
    Search requirements even when the Worker took the stateless fast path.

    The compact fast path hydrates conversation.dialogue_state, but does NOT
    load historical Client Memory. MEM06 relied on context.memory.active_facts
    alone and could emit "2 bedroom under AED 5000000", silently dropping
    apartment and Dubai Marina. Only for an explicit "everything else stays
    the same" max-budget refinement, fill missing Search criteria from the
    persisted request_state of that same verified search thread.

    Do not overwrite newer/current-turn facts. Do not change canonical Memory,
    persist state, run another DB query, or inherit these facts for new searches.
  */
  const previousRequest =
    context?.conversation?.dialogue_state?.request_state || null;
  const existingFacts = Array.isArray(context?.memory?.active_facts)
    ? context.memory.active_facts : [];
  const resolvedFacts = [...existingFacts];
  const hasFact = key => resolvedFacts.some(item =>
    item?.fact_key === key && item.fact_value !== null &&
    typeof item.fact_value !== "undefined" && item.fact_value !== ""
  );

  if (previousRequest && typeof previousRequest === "object" &&
      !Array.isArray(previousRequest)) {
    const previousProperty = previousRequest.property_type;
    if (!hasFact("property_type") &&
        typeof previousProperty === "string" &&
        /^(?:apartment|villa|townhouse|penthouse|duplex|studio|plot)$/i
          .test(previousProperty)) {
      resolvedFacts.push({fact_key:"property_type",fact_value:previousProperty});
    }

    const previousBedrooms = previousRequest.bedrooms;
    if (!hasFact("bedrooms") && previousBedrooms !== null &&
        previousBedrooms !== "" && Number.isInteger(Number(previousBedrooms)) &&
        Number(previousBedrooms) >= 0 && Number(previousBedrooms) <= 20) {
      resolvedFacts.push({fact_key:"bedrooms",fact_value:Number(previousBedrooms)});
    }

    const previousLocation = normalizePreferredLocationTextV1(previousRequest.location);
    if (!hasFact("preferred_location_text") && previousLocation) {
      resolvedFacts.push({
        fact_key:"preferred_location_text",
        fact_value:previousLocation
      });
    }
  }

  return augmentSearchQueryWithMemory({
    query: "Find projects",
    context: {
      ...context,
      memory: {...(context?.memory || {}), active_facts: resolvedFacts}
    },
    explicitMaxBudgetAed: maxAed
  });
}


/*
  MEM18 — Profile-aware F1 recommendations.
  This is a narrow intent-specific bridge: turn a clearly personalized
  "other options based on our discussion" request into a deterministic
  catalog query using current canonical facts / verified request_state.

  Do NOT apply prior constraints to a new explicit location/price/type
  search. Do NOT claim unit-specific price or rental yield verification.
  Decision Memory exclusions are supplied as catalog candidate metadata,
  never inferred from project mentions alone.
*/
function personalizedRecommendationV1({message = "", context = null} = {}) {
  const q = String(message || "").trim();
  if (!/\b(?:recommend|suggest|show|find|give|pick|choose)\b/i.test(q) ||
      !/\b(?:projects?|properties|options|alternatives|homes?|apartments?)\b/i.test(q) ||
      !/\b(?:based on (?:everything|what|all) (?:we(?:'ve| have)?|you(?:'ve| have)?) (?:discussed|talked about|know)|based on everything|for me based on|given (?:my|our) (?:preferences|requirements)|using (?:my|our) (?:preferences|requirements))\b/i.test(q)) {
    return null;
  }

  // A separately specified, new search takes precedence over saved profile.
  if (/\b(?:in|near|around|across|within)\s+(?:Dubai|Abu Dhabi|Sharjah|Ajman|Fujairah|Ras Al Khaimah|Umm Al Quwain|Marina|JVC)\b/i.test(q) ||
      /\b(?:studio|apartments?|villas?|townhouses?|penthouses?|duplex|plots?|\d+\s*[- ]?\s*(?:bedrooms?|br|beds?))\b/i.test(q) ||
      /\b(?:AED|DHS?|up to|under|below|over|above|between)\s*[\d,]/i.test(q) ||
      /\b(?:compare|vs\.?|versus|call|contact|whatsapp|viewing)\b/i.test(q)) {
    return null;
  }

  const state = context?.conversation?.dialogue_state?.request_state || {};
  const facts = Array.isArray(context?.memory?.active_facts)
    ? context.memory.active_facts : [];
  const saved = key => {
    for (let i = facts.length - 1; i >= 0; i--) {
      if (facts[i]?.fact_key === key && facts[i].fact_value != null) {
        return facts[i].fact_value;
      }
    }
    return null;
  };

  const firstValid = (...values) =>
    values.find(v => v !== null && v !== undefined && v !== "") ?? null;
  const rawType = firstValid(saved("property_type"), state.property_type);
  const type = typeof rawType === "string" &&
    /^(?:apartment|villa|townhouse|penthouse|duplex|studio)$/i.test(rawType.trim())
      ? rawType.trim().toLowerCase() : null;
  const rawBedrooms = firstValid(saved("bedrooms"), state.bedrooms);
  const bedrooms = rawBedrooms === null ? null : Number(rawBedrooms);
  const validBedrooms = Number.isInteger(bedrooms) && bedrooms >= 0 && bedrooms <= 10
    ? bedrooms : null;
  const location = normalizePreferredLocationTextV1(saved("preferred_location_text")) ??
    normalizePreferredLocationTextV1(state.location);
  const rawBudget = firstValid(saved("budget_max_aed"), state?.budget?.max_aed);
  const budget = rawBudget === null ? null : Number(rawBudget);
  const maxAed = Number.isSafeInteger(budget) && budget >= 10000 && budget <= 10_000_000_000
    ? budget : null;

  // Do not create a fabricated personalized search with no verified filters.
  if (![type, validBedrooms, location, maxAed].some(v => v !== null)) {
    return null;
  }

  const words = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const countMatch = q.match(/\b(?:recommend|suggest|show|find|give|pick|choose)\s+(?:(?:me|us)\s+)?(10|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:other\s+)?(?:projects?|properties|options|alternatives)\b/i);
  const limit = countMatch ? (words[countMatch[1].toLowerCase()] || Number(countMatch[1])) : 3;
  const parts = [`Find ${limit} projects`];
  if (validBedrooms !== null) parts.push(`${validBedrooms} bedroom`);
  if (type) parts.push(type);
  if (location) parts.push(`in ${location}`);
  if (maxAed !== null) parts.push(`up to AED ${maxAed}`);

  const excludingExisting = /\b(?:other|more|another|alternative|new)\b/i.test(q);
  const excluded = excludingExisting
    ? facts.filter(f => typeof f?.fact_key === "string" &&
        f.fact_key.startsWith("project_decision:") &&
        ["shortlisted", "rejected"].includes(f?.fact_value?.status))
      .map(f => f.fact_key.slice("project_decision:".length))
      .filter(slug => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    : [];

  return {
    query: parts.join(" "),
    requested_count: limit,
    exclude_project_slugs: [...new Set(excluded)].slice(0, 100)
  };
}


export function buildPrimaSearchRequest({
  route = null,
  message = "",
  context = null
} = {}) {
  /*
    Prima Search V1 returns Projects only.

    Recommendation will use the same tool,
    but its orchestration is connected after
    the base property_search path is closed.
  */
  const propertySearch =
    route === "property_search";

  const recommendationSearch =
    route === "recommendation" &&
    recommendationNeedsSearch({
      message,
      context
    });

  if (
    !propertySearch &&
    !recommendationSearch
  ) {
    return null;
  }

  // A carried prior SearchContext is conversational evidence, not proof
  // that a NEW refinement has already run. Only the tool continuation
  // completes the current search request.
  if (completedSearchContext(context) &&
      context?.turn?.phase === "tool_continuation") {
    return null;
  }

  const contextualQuery =
    contextualSearchQuery({
      message,
      context
    });

  // D3_SEARCH_CONTEXT_SCOPE_V7: retained buyer facts are only implied
  // for an explicit continuation of an existing verified search thread.
  // A new named-project/area search must not silently inherit old budgets,
  // bedrooms, locations or lifestyle preferences from another search.
  // No model call, no project/district-specific rules.
  const savedSearch =
    context?.conversation?.dialogue_state
      ?.continuity_references?.active_search_context;
  const continuingPreviousSearch =
    savedSearch?.state === "results" &&
    Number(savedSearch?.result_count) > 0 &&
    context?.conversation?.dialogue_state?.active_thread
      ?.active_topic === "property_search" &&
    /\b(?:same|those|these|previous|earlier|last|remaining|keep|still|more|only|them|ones|refine|change|lower|increase|reduce|update)\b/i
      .test(String(message || "")) &&
    !/\b(?:similar\s+to|cheaper\s+than)\s+[A-Z]/i
      .test(String(message || ""));

  const exactMaxRefinement =
    continuingPreviousSearch
      ? explicitMaxBudgetContinuation({message, context})
      : null;

  const personalized = recommendationSearch
    ? personalizedRecommendationV1({message, context})
    : null;
  const searchTurnKind = classifySearchTurnV1({message,route,context});
  const semanticallyGroundedQuery = contextualSearchQueryV1({message,context});
  // Never turn "that area" into a UAE-wide search because semantic
  // context is absent, or silently drop preserved filters on a refinement.
  if (["refinement", "contextual_search"].includes(searchTurnKind) &&
      !semanticallyGroundedQuery) return null;
  const query =
    personalized?.query ||
    semanticallyGroundedQuery ||
    exactMaxRefinement ||
    (continuingPreviousSearch
      ? augmentSearchQueryWithMemory({query: contextualQuery, context})
      : contextualQuery);

  if (!query) {
    return null;
  }

  return {
    version:
      "PrimaToolRequestV1",

    tool:
      "prima_search",

    action:
      "search_projects",

    language:
      "en",

    entity_type:
      "project",

    query,

    ...(personalized ? {
      requested_count: personalized.requested_count,
      exclude_project_slugs: personalized.exclude_project_slugs
    } : {}),

    max_results:
      10
  };
}
