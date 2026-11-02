const PAGE_TYPE_DOMAIN = Object.freeze({
  project_page: "project",
  developer_page: "developer",
  district_page: "district",

  project_comparison_page: "project_comparison",
  developer_comparison_page: "developer_comparison",
  district_comparison_page: "district_comparison",

  buyer_scenario_page: "buyer_scenario",
  budget_page: "budget",
  intent_page: "intent",
  property_type_page: "property_type",
  origin_buyer_page: "origin_buyer",
  ai_answer_page: "ai_answer",

  homepage: "homepage"
});


function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}


function hasAny(q, patterns = []) {
  return patterns.some(pattern =>
    pattern.test(q)
  );
}


function detectTopics(message = "") {
  const q =
    String(message).toLowerCase();

  const topics = [];

  if (
    hasAny(q, [
      /\bfamil(y|ies)\b/,
      /\bchildren\b/,
      /\bkids\b/,
      /\bschool\b/,
      /\blive\b/,
      /\bliving\b/
    ])
  ) {
    topics.push("family_living");
  }

  if (
    hasAny(q, [
      /\binvest\b/,
      /\binvestment\b/,
      /\brental\b/,
      /\byield\b/,
      /\bcapital appreciation\b/,
      /\broi\b/,
      /\breturn\b/
    ])
  ) {
    topics.push("investment");
  }

  if (
    hasAny(q, [
      /\brisk\b/,
      /\brisks\b/,
      /\bdownside\b/,
      /\btrade[- ]?off\b/,
      /\bconcern\b/
    ])
  ) {
    topics.push("risk");
  }

  if (
    hasAny(q, [
      /\bpayment plan\b/,
      /\binstallment\b/,
      /\bmortgage\b/,
      /\bcash\b/,
      /\bfinance\b/,
      /\bfinancing\b/
    ])
  ) {
    topics.push("financing");
  }

  if (
    hasAny(q, [
      /\blocation\b/,
      /\bdistrict\b/,
      /\barea\b/,
      /\bcommunity\b/,
      /\bneighbou?rhood\b/
    ])
  ) {
    topics.push("location");
  }

  if (
    hasAny(q, [
      /\bbudget\b/,
      /\bprice\b/,
      /\bafford\b/,
      /\bunder aed\b/,
      /\bmillion\b/
    ])
  ) {
    topics.push("budget");
  }

  if (
    hasAny(q, [
      /\bbedroom\b/,
      /\bbedrooms\b/,
      /\b2br\b/,
      /\b3br\b/,
      /\b4br\b/,
      /\bvilla\b/,
      /\bapartment\b/,
      /\btownhouse\b/,
      /\bpenthouse\b/
    ])
  ) {
    topics.push("property_type");
  }

  if (
    hasAny(q, [
      /\bdeveloper\b/,
      /\btrack record\b/,
      /\bdelivery\b/,
      /\breputation\b/
    ])
  ) {
    topics.push("developer");
  }

  if (
    hasAny(q, [
      /\bmarket\b/,
      /\btrend\b/,
      /\btransactions\b/,
      /\bdemand\b/,
      /\bperformance\b/
    ])
  ) {
    topics.push("market");
  }

  return uniq(topics);
}


function currentDomain(context = {}) {
  const pageType =
    context?.page?.page_type || "homepage";

  return (
    PAGE_TYPE_DOMAIN[pageType] ||
    pageType ||
    "unknown"
  );
}


function baseCurrentEntityNeeds(
  context = {}
) {
  const needs = [];

  if (
    context?.entity?.primary_slug ||
    (
      context?.page?.page_type &&
      context.page.page_type !== "homepage"
    )
  ) {
    needs.push(
      "current_page.summary",
      "current_entity.facts"
    );
  }

  return needs;
}


function topicNeeds(topics = []) {
  const needs = [];

  for (const topic of topics) {
    switch (topic) {
      case "family_living":
        needs.push(
          "current_entity.buyer_fit",
          "knowledge.buyer_scenario",
          "related.district"
        );
        break;

      case "investment":
        needs.push(
          "current_entity.investment_logic",
          "knowledge.intent",
          "related.district"
        );
        break;

      case "risk":
        needs.push(
          "current_entity.risks",
          "current_entity.decision_logic",
          "related.entities"
        );
        break;

      case "financing":
        needs.push(
          "current_entity.payment_facts",
          "knowledge.budget"
        );
        break;

      case "location":
        needs.push(
          "related.district",
          "current_entity.location"
        );
        break;

      case "budget":
        needs.push(
          "current_entity.price_facts",
          "knowledge.budget"
        );
        break;

      case "property_type":
        needs.push(
          "current_entity.unit_facts",
          "knowledge.property_type"
        );
        break;

      case "developer":
        needs.push(
          "related.developer",
          "developer.context"
        );
        break;

      case "market":
        needs.push(
          "market.context",
          "knowledge.ai_answer"
        );
        break;

      default:
        break;
    }
  }

  return uniq(needs);
}


export function buildKnowledgePlan({
  route = null,
  message = "",
  context = {}
} = {}) {
  const interpretedTasks =
    Array.isArray(
      context
        ?.request_interpretation
        ?.tasks
    )
      ? context
          .request_interpretation
          .tasks
      : [];

  const interpretedTask =
    interpretedTasks.find(
      task =>
        task?.route === route
    ) ||
    interpretedTasks[0] ||
    null;

  const interpretedTopics =
    Array.isArray(
      interpretedTask?.topics
    )
      ? interpretedTask
          .topics
          .filter(Boolean)
      : [];

  const topics =
    interpretedTopics.length > 0
      ? uniq(interpretedTopics)
      : detectTopics(message);

  const domain =
    currentDomain(context);

  const plan = {
    version: "KnowledgePlannerV1",

    route,
    domain,
    topics,

    needs: [],

    include_current_page: false,
    include_related_entities: false,
    include_market_context: false,

    max_primary_blocks: 6,
    max_related_entities: 4,
    max_knowledge_pages: 4,

    reasoning_required: false
  };


  // -------------------------------------------------------
  // EXACT FACT
  // Existing fast path remains authoritative.
  // -------------------------------------------------------

  if (route === "exact_fact") {
    plan.needs = [
      "current_entity.exact_fact"
    ];

    plan.include_current_page = true;

    return plan;
  }


  // -------------------------------------------------------
  // PAGE QUESTION
  // Current page first. Related knowledge only if useful.
  // -------------------------------------------------------

  if (
    route === "page_question" ||
    route === "follow_up"
  ) {
    plan.needs = uniq([
      ...baseCurrentEntityNeeds(context),
      ...topicNeeds(topics)
    ]);

    plan.include_current_page = true;

    plan.include_related_entities =
      topics.length > 0;

    plan.reasoning_required = true;

    return plan;
  }


  // -------------------------------------------------------
  // MARKET QUESTION
  // -------------------------------------------------------

  if (route === "market_question") {
    plan.needs = uniq([
      "market.context",
      "knowledge.ai_answer",
      ...topicNeeds(topics)
    ]);

    plan.include_market_context = true;
    plan.reasoning_required = true;

    return plan;
  }


  // -------------------------------------------------------
  // COMPARISON
  // -------------------------------------------------------

  if (route === "compare") {
    plan.needs = uniq([
      ...baseCurrentEntityNeeds(context),
      "comparison.entities",
      "comparison.facts",
      "comparison.tradeoffs",
      "related.entities",
      ...topicNeeds(topics)
    ]);

    plan.include_current_page = true;
    plan.include_related_entities = true;
    plan.reasoning_required = true;

    plan.max_primary_blocks = 8;
    plan.max_related_entities = 6;

    return plan;
  }


  // -------------------------------------------------------
  // RECOMMENDATION
  // Knowledge Planner prepares reasoning knowledge.
  // Actual commercial retrieval still belongs to Prima Search.
  // -------------------------------------------------------

  if (route === "recommendation") {
    plan.needs = uniq([
      ...baseCurrentEntityNeeds(context),
      "client.goal",
      "client.preferences",
      "knowledge.buyer_scenario",
      "knowledge.budget",
      "knowledge.intent",
      "knowledge.property_type",
      ...topicNeeds(topics)
    ]);

    plan.include_current_page =
      domain !== "homepage";

    plan.include_related_entities = true;
    plan.include_market_context = true;
    plan.reasoning_required = true;

    plan.max_primary_blocks = 6;
    plan.max_related_entities = 6;
    plan.max_knowledge_pages = 6;

    return plan;
  }


  // -------------------------------------------------------
  // Routes that do not need knowledge retrieval.
  // -------------------------------------------------------

  plan.needs = [];

  return plan;
}


export function getKnowledgePlannerDebug(plan = {}) {
  return {
    version:
      plan?.version || "KnowledgePlannerV1",

    route:
      plan?.route || null,

    domain:
      plan?.domain || null,

    topics:
      plan?.topics || [],

    needs:
      plan?.needs || [],

    reasoning_required:
      plan?.reasoning_required === true
  };
}
