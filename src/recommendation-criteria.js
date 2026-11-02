import { normalizePreferredLocationTextV1 } from "./preferred-location-v1.js";

// F23_RECOMMENDATION_MISSING_CRITERIA_V1
// Pure recommendation analysis.
// No Search, Memory writes, dialogue control or OpenAI calls.

const CRITERIA = [
  "budget",
  "property_type",
  "goal",
  "bedrooms",
  "district",
  "timeline"
];

const IMPORTANCE = {
  budget: 90,
  property_type: 85,
  goal: 75,
  bedrooms: 70,
  district: 60,
  timeline: 50
};

function isKnown(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value))
    return value.some(isKnown);
  if (typeof value === "object")
    return Object.values(value).some(isKnown);
  return true;
}

function candidateValue(candidate, criterion) {
  if (!candidate || typeof candidate !== "object") return null;

  switch (criterion) {
    case "budget": {
      const price = Number(candidate.price_amount);
      return Number.isFinite(price) && price > 0
        ? Math.floor(Math.log2(price / 250000))
        : null;
    }

    case "property_type":
      return candidate.machine_property_type ||
        candidate.property_type || null;

    case "district":
      return candidate.district || null;

    case "bedrooms":
      return candidate.bedrooms || null;

    case "goal": {
      const features = Array.isArray(candidate.features)
        ? candidate.features : [];
      const relevant = features.filter(
        x => x === "family" || x === "investment"
      );
      return relevant.length ? relevant.sort().join("|") : null;
    }

    case "timeline":
      return candidate.handover || null;

    default:
      return null;
  }
}

export function analyzeRecommendationCriteriaV1({
  route = "recommendation",
  known_constraints = {},
  candidates = [],
  requested_count = 3
} = {}) {
  if (route !== "recommendation") return null;

  const known = {};
  const missing = [];

  for (const criterion of CRITERIA) {
    const value = known_constraints?.[criterion];

    if (isKnown(value)) {
      known[criterion] = value;
    } else {
      known[criterion] = null;
      missing.push(criterion);
    }
  }

  const validCandidates = Array.isArray(candidates)
    ? candidates.filter(
        x => x && typeof x === "object" && !Array.isArray(x)
      )
    : [];

  const analysis = missing.map(criterion => {
    const values = validCandidates
      .map(x => candidateValue(x, criterion))
      .filter(isKnown)
      .map(x => String(x).toLowerCase());

    const distinct = new Set(values).size;

    // Measures expected usefulness of an additional constraint,
    // NOT project quality, value, or recommendation rating.
    const utility =
      IMPORTANCE[criterion] +
      (distinct >= 2 ? 16 : 0) +
      (values.length > 0 ? 5 : 0);

    return {
      criterion,
      utility,
      candidate_coverage: values.length,
      distinct_candidate_values: distinct
    };
  });

  analysis.sort(
    (a, b) => b.utility - a.utility ||
      CRITERIA.indexOf(a.criterion) -
      CRITERIA.indexOf(b.criterion)
  );

  const recommended = validCandidates.length
    ? analysis[0] || null
    : null;

  return {
    version: "RecommendationCriteriaV1",
    entity_type: "project",
    requested_count:
      Number.isInteger(requested_count) &&
      requested_count >= 1 &&
      requested_count <= 10
        ? requested_count
        : 3,
    candidate_count: validCandidates.length,
    known_constraints: known,
    missing_criteria: analysis.map(x => x.criterion),
    suggested_clarification: recommended
      ? {
          criterion: recommended.criterion,
          reason_code: "expected_shortlist_refinement_value",
          candidate_coverage: recommended.candidate_coverage,
          distinct_candidate_values:
            recommended.distinct_candidate_values
        }
      : null,
    note: "Advisory metadata only; Block C decides whether to clarify."
  };
}


// F24_RECOMMENDATION_CRITERIA_WORKER_HANDOFF_V1
// Read-only adapter for already prepared context.
// No conversation control or memory persistence.

export function recommendationKnownConstraintsV1(context = {}) {
  const state =
    context?.conversation?.dialogue_state?.request_state || {};

  const filters =
    context?.search?.filters || {};

  const facts =
    Array.isArray(context?.memory?.active_facts)
      ? context.memory.active_facts
      : [];

  const pick = (...values) =>
    values.find(value => isKnown(value)) ?? null;

  const memoryFact = (...keys) => {
    for (let i = facts.length - 1; i >= 0; i--) {
      const item = facts[i];

      if (
        keys.includes(
          String(item?.fact_key || "").toLowerCase()
        ) &&
        isKnown(item?.fact_value)
      ) {
        return item.fact_value;
      }
    }

    return null;
  };

  const validBudget = value => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return null;
    }

    return [
      value.min_aed,
      value.max_aed,
      value.target_aed,
      value.min,
      value.max,
      value.from,
      value.to
    ].some(isKnown)
      ? value
      : null;
  };

  const budgetNumber = value => {
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ""
    ) {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number) && number > 0
      ? number
      : null;
  };

  const memoryMin = budgetNumber(
    memoryFact("budget_min_aed", "min_budget_aed")
  );

  const memoryMax = budgetNumber(
    memoryFact("budget_max_aed", "max_budget_aed")
  );

  const memoryBudget =
    memoryMin !== null || memoryMax !== null
      ? {
          min_aed: memoryMin,
          max_aed: memoryMax
        }
      : null;

  // F210_RECOMMENDATION_PRICE_BUDGET_INTEGRITY_V1
  // The current verified SearchContext takes precedence
  // over an older or incorrectly normalized state value.
  // No writes to Conversation State or Memory.
  const rawBudget =
    pick(
      validBudget(filters.budget),
      validBudget(state.budget),
      validBudget(memoryFact("budget")),
      memoryBudget
    );

  // F25_RECOMMENDATION_CONSTRAINT_ACCURACY_V1
  // Read-only safeguard if SearchContext normalization
  // does not retain the explicit property type.
  const typeMatch = String(
    context?.user?.message || ""
  ).match(
    /\b(apartments?|villas?|townhouses?|penthouses?|duplex(?:es)?)\b/i
  );

  const explicitType = typeMatch
    ? (
        /^apart/i.test(typeMatch[1]) ? "apartment" :
        /^villa/i.test(typeMatch[1]) ? "villa" :
        /^townhouse/i.test(typeMatch[1]) ? "townhouse" :
        /^penthouse/i.test(typeMatch[1]) ? "penthouse" :
        "duplex"
      )
    : null;

  const type =
    pick(
      Array.isArray(filters.property_types)
        ? filters.property_types[0]
        : null,
      filters.property_type,
      explicitType,
      state.property_type,
      memoryFact(
        "property_type",
        "preferred_property_type"
      )
    );

  const goal =
    pick(
      state.goal,
      memoryFact(
        "goal",
        "purchase_goal",
        "buyer_goal"
      ),
      filters.investment === true
        ? "investment"
        : null
    );

  // F211_RECOMMENDATION_BEDROOM_CONSTRAINT_V1
  // The current search constraint takes precedence.
  const bedrooms =
    pick(
      Array.isArray(filters.bedrooms)
        ? filters.bedrooms[0]
        : null,
      state.bedrooms,
      memoryFact(
        "bedrooms",
        "preferred_bedrooms"
      )
    );

  const location = pick(
    normalizePreferredLocationTextV1(filters.district),
    normalizePreferredLocationTextV1(state.location?.district),
    normalizePreferredLocationTextV1(state.location),
    normalizePreferredLocationTextV1(memoryFact("preferred_location_text")),
    normalizePreferredLocationTextV1(memoryFact("district", "preferred_district"))
  );

  // City/emirate alone is not a known district.
  const district =
    typeof location === "string" &&
    !/^(dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain|uae|united arab emirates)$/i
      .test(location.trim())
      ? location
      : null;

  const timeline =
    pick(
      state.timeline,
      memoryFact(
        "timeline",
        "handover_preference"
      )
    );

  return {
    budget: rawBudget,
    property_type: type,
    goal,
    bedrooms,
    district,
    timeline
  };
}
