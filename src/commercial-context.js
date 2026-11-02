
// G41_COMMERCIAL_CONTEXT_V1
// Deterministic normalization of existing Interpreter + Memory.
// No CTA decision, no response templates, no new LLM call.

const FACT_NEEDS = Object.freeze({
  availability: "availability",
  unit_availability: "availability",
  payment_plan: "payment_terms",
  payment_terms: "payment_terms",
  viewing: "viewing",
  comparison: "comparison",
  price: "pricing",
  rental_yield: "investment_analysis",
  roi: "investment_analysis"
});

const COMMERCIAL_INTENTS = new Set([
  "availability",
  "payment_terms",
  "comparison",
  "shortlist_review",
  "purchase_ready",
  "viewing",
  "specialist_contact"
]);

const SAFE_MEMORY_KEYS = new Set([
  "budget_min_aed",
  "budget_max_aed",
  "bedrooms",
  "property_type",
  "buyer_goal",
  "timeline",
  "preferred_district",
  "preferred_location",
  "project_slug"
]);

export function buildCommercialContextV1({
  interpretation = null,
  activeMemory = [],
  context = {},
  route = null
} = {}) {
  const valid =
    interpretation?.version === "RequestInterpreterV1";

  const tasks =
    valid && Array.isArray(interpretation.tasks)
      ? interpretation.tasks
      : [];

  const signal =
    valid ? interpretation.commercial_signal : null;

  const requestedFacts = new Set();
  const needs = new Set();

  let pendingClarification = false;

  for (const task of tasks) {
    if (task?.needs_clarification === true) {
      pendingClarification = true;
    }

    for (const fact of task?.requested_facts || []) {
      if (typeof fact !== "string") continue;

      requestedFacts.add(fact);

      if (FACT_NEEDS[fact]) {
        needs.add(FACT_NEEDS[fact]);
      }
    }
  }

  const primaryIntent =
    typeof signal?.intent === "string"
      ? signal.intent
      : "none";

  if (COMMERCIAL_INTENTS.has(primaryIntent)) {
    needs.add(primaryIntent);
  }

  const memoryFacts = {};
  const facts = Array.isArray(activeMemory)
    ? activeMemory
    : [];

  for (const fact of facts) {
    if (
      SAFE_MEMORY_KEYS.has(fact?.fact_key) &&
      fact?.fact_value != null
    ) {
      memoryFacts[fact.fact_key] = fact.fact_value;
    }
  }

  const funnel = [...facts].reverse().find(
    fact => fact?.fact_key === "funnel_state"
  )?.fact_value || null;

  const continuity =
    context?.conversation?.dialogue_state
      ?.continuity_references?.current_entity;

  const primaryProjectSlug =
    context?.working_entity?.slug ||
    (
      continuity?.type === "project"
        ? continuity.slug
        : null
    ) ||
    context?.entity?.primary_slug ||
    memoryFacts.project_slug ||
    null;

  const projectEntities =
    valid && Array.isArray(interpretation.entities)
      ? interpretation.entities
          .filter(entity => entity?.type === "project")
          .map(entity => ({
            type: "project",
            name: entity.name || entity.value || null,
            slug: entity.slug || null
          }))
      : [];

  const commercialNeeds = [...needs];

  const stageHint =
    primaryIntent === "purchase_ready"
      ? "decision"
      : primaryIntent === "viewing"
        ? "action"
        : commercialNeeds.some(need =>
            [
              "availability",
              "payment_terms",
              "pricing"
            ].includes(need)
          )
          ? "evaluation"
          : commercialNeeds.some(need =>
              [
                "comparison",
                "shortlist_review"
              ].includes(need)
            )
            ? "consideration"
            : "undetermined";

  return {
    version: "CommercialContextV1",

    route,

    interpretation: {
      available: valid,
      overall_confidence:
        valid
          ? interpretation.overall_confidence ?? null
          : null,
      primary_commercial_intent: primaryIntent,
      commercial_confidence:
        signal?.confidence ?? null
    },

    requested_facts: [...requestedFacts],
    commercial_needs: commercialNeeds,

    buyer_context: {
      stage_hint: stageHint,
      primary_project_slug: primaryProjectSlug,
      project_entities: projectEntities,
      known_facts: memoryFacts,
      pending_clarification: pendingClarification
    },

    interaction: {
      explicit_specialist_request:
        primaryIntent === "specialist_contact" &&
        signal?.explicit_request === true,

      explicit_viewing_request:
        primaryIntent === "viewing" &&
        signal?.explicit_request === true,

      funnel_status:
        funnel?.status || null,

      contact_opted_out:
        funnel?.status === "contact_opted_out"
    }
  };
}
