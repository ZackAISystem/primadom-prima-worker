const PAGE_ADAPTERS = Object.freeze({

  project_page: {
    summary: ["short_answer"],
    facts: ["key_facts"],
    buyer_fit: ["buyer_fit", "project_logic"],
    risks: ["project_logic", "decision_cards", "faq"],
    decision_logic: ["project_logic", "decision_cards"],
    investment_logic: ["project_logic", "buyer_fit", "decision_cards"],
    payment_facts: ["key_facts", "project_logic"],
    location: ["location", "key_facts"],
    price_facts: ["key_facts"],
    unit_facts: ["key_facts"],
    related_entities: ["location", "similar_projects"],
    related_district: ["location"],
    related_developer: ["key_facts", "project_logic"]
  },

  developer_page: {
    summary: ["short_summary"],
    facts: ["developer_facts"],
    buyer_fit: ["buyer_fit_logic"],
    risks: ["buyer_fit_logic", "decision_cards", "faq"],
    decision_logic: ["buyer_fit_logic", "decision_cards"],
    investment_logic: ["buyer_fit_logic", "districts_segment"],
    developer_context: [
      "developer_facts",
      "buyer_fit_logic",
      "projects_portfolio",
      "districts_segment"
    ],
    related_entities: [
      "projects_portfolio",
      "districts_segment",
      "similar_developers"
    ],
    related_district: ["districts_segment"]
  },

  district_page: {
    summary: ["short_verdict"],
    facts: ["area_facts"],
    buyer_fit: ["buyer_fit_logic"],
    risks: ["buyer_fit_logic", "decision_cards", "faq"],
    decision_logic: ["buyer_fit_logic", "decision_cards"],
    investment_logic: [
      "buyer_fit_logic",
      "projects_developers",
      "decision_cards"
    ],
    location: ["landmarks_location", "area_facts"],
    related_entities: [
      "projects_developers",
      "similar_districts"
    ],
    related_developer: ["projects_developers"]
  },

  project_comparison_page: {
    summary: ["quick_recommendation"],
    facts: ["comparison_facts"],
    buyer_fit: ["buyer_investment_logic"],
    risks: [
      "project_comparison_table",
      "decision_cards",
      "buyer_investment_logic"
    ],
    decision_logic: [
      "project_summaries_logic",
      "decision_cards",
      "buyer_investment_logic"
    ],
    investment_logic: ["buyer_investment_logic"],
    comparison_entities: ["project_summaries_logic"],
    comparison_facts: [
      "comparison_facts",
      "project_comparison_table"
    ],
    comparison_tradeoffs: [
      "project_comparison_table",
      "decision_cards",
      "buyer_investment_logic"
    ],
    related_entities: ["projects_alternatives"]
  },

  developer_comparison_page: {
    summary: ["quick_verdict"],
    facts: ["comparison_facts"],
    buyer_fit: ["buyer_investment_logic"],
    risks: [
      "segment_comparison_table",
      "decision_cards",
      "buyer_investment_logic"
    ],
    decision_logic: [
      "developer_profiles_segment_logic",
      "decision_cards"
    ],
    investment_logic: ["buyer_investment_logic"],
    comparison_entities: [
      "developer_profiles_segment_logic"
    ],
    comparison_facts: [
      "comparison_facts",
      "segment_comparison_table"
    ],
    comparison_tradeoffs: [
      "segment_comparison_table",
      "decision_cards",
      "buyer_investment_logic"
    ],
    related_entities: ["projects_by_developer"]
  },

  district_comparison_page: {
    summary: ["quick_verdict"],
    facts: ["comparison_facts"],
    buyer_fit: ["buyer_rental_logic"],
    risks: [
      "comparison_table",
      "decision_cards",
      "buyer_rental_logic"
    ],
    decision_logic: [
      "comparison_table",
      "decision_cards",
      "buyer_rental_logic"
    ],
    investment_logic: ["buyer_rental_logic"],
    comparison_entities: ["comparison_table"],
    comparison_facts: [
      "comparison_facts",
      "comparison_table"
    ],
    comparison_tradeoffs: [
      "comparison_table",
      "decision_cards",
      "buyer_rental_logic"
    ],
    related_entities: ["projects_by_area"]
  },

  buyer_scenario_page: {
    summary: ["scenario_answer"],
    facts: ["scenario_facts"],
    buyer_fit: ["buyer_logic"],
    risks: ["process_risks", "decision_cards"],
    decision_logic: ["buyer_logic", "decision_cards"],
    investment_logic: ["buyer_logic", "projects_budget"],
    related_entities: [
      "districts_types",
      "projects_budget",
      "related_scenarios"
    ]
  },

  budget_page: {
    summary: ["direct_answer"],
    facts: ["budget_facts"],
    buyer_fit: ["districts_types", "projects_fit"],
    risks: ["costs_tradeoffs", "decision_cards"],
    decision_logic: [
      "projects_fit",
      "decision_cards",
      "costs_tradeoffs"
    ],
    investment_logic: ["projects_fit", "costs_tradeoffs"],
    price_facts: ["budget_facts"],
    related_entities: [
      "districts_types",
      "projects_fit",
      "related_budget_pages"
    ]
  },

  intent_page: {
    summary: ["short_verdict"],
    facts: ["intent_facts"],
    buyer_fit: ["buyer_fit_risk"],
    risks: ["buyer_fit_risk", "decision_cards"],
    decision_logic: [
      "best_options",
      "selection_logic",
      "decision_cards"
    ],
    investment_logic: [
      "selection_logic",
      "buyer_fit_risk"
    ],
    related_entities: ["districts_projects"]
  },

  property_type_page: {
    summary: ["property_summary"],
    facts: ["property_facts"],
    buyer_fit: ["buyer_logic"],
    risks: ["projects_pros_cons", "decision_cards"],
    decision_logic: [
      "buyer_logic",
      "decision_cards",
      "projects_pros_cons"
    ],
    investment_logic: [
      "buyer_logic",
      "districts_price",
      "projects_pros_cons"
    ],
    price_facts: ["property_facts", "districts_price"],
    unit_facts: ["property_facts"],
    related_entities: [
      "districts_price",
      "projects_pros_cons",
      "similar_property_types"
    ]
  },

  origin_buyer_page: {
    summary: ["can_buy_answer"],
    facts: ["origin_facts"],
    buyer_fit: ["process_documents"],
    risks: ["districts_concerns", "decision_cards"],
    decision_logic: [
      "process_documents",
      "decision_cards",
      "districts_concerns"
    ],
    related_entities: [
      "districts_concerns",
      "projects_visa",
      "related_origin_pages"
    ]
  },

  ai_answer_page: {
    summary: ["direct_answer"],
    facts: ["answer_facts"],
    risks: ["checks_risks", "decision_cards"],
    decision_logic: [
      "yes_no",
      "decision_cards",
      "checks_risks"
    ],
    related_entities: ["next_pages"]
  }
});


const NEED_TO_ROLE = Object.freeze({
  "current_page.summary": "summary",
  "current_entity.facts": "facts",
  "current_entity.buyer_fit": "buyer_fit",
  "current_entity.risks": "risks",
  "current_entity.decision_logic": "decision_logic",
  "current_entity.investment_logic": "investment_logic",
  "current_entity.payment_facts": "payment_facts",
  "current_entity.location": "location",
  "current_entity.price_facts": "price_facts",
  "current_entity.unit_facts": "unit_facts",

  "related.entities": "related_entities",
  "related.district": "related_district",
  "related.developer": "related_developer",

  "developer.context": "developer_context",

  "comparison.entities": "comparison_entities",
  "comparison.facts": "comparison_facts",
  "comparison.tradeoffs": "comparison_tradeoffs"
});


const KNOWLEDGE_PAGE_TARGETS = Object.freeze({
  "knowledge.buyer_scenario": [
    "buyer_scenario_page"
  ],

  "knowledge.budget": [
    "budget_page"
  ],

  "knowledge.intent": [
    "intent_page"
  ],

  "knowledge.property_type": [
    "property_type_page"
  ],

  "knowledge.ai_answer": [
    "ai_answer_page"
  ],

  "market.context": [
    "ai_answer_page"
  ]
});


function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}


export function getKnowledgeAdapter(
  pageType
) {
  return PAGE_ADAPTERS[pageType] || null;
}


export function getAdapterPageTypes() {
  return Object.keys(PAGE_ADAPTERS);
}


export function getBlockFamiliesForNeeds(
  pageType,
  needs = []
) {
  const adapter =
    getKnowledgeAdapter(pageType);

  if (!adapter) {
    return [];
  }

  const families = [];

  for (const need of needs) {
    const role =
      NEED_TO_ROLE[need];

    if (!role) {
      continue;
    }

    const candidates =
      adapter[role] || [];

    families.push(...candidates);
  }

  return uniq(families);
}


export function getKnowledgePageTargets(
  needs = []
) {
  const targets = [];

  for (const need of needs) {
    const pageTypes =
      KNOWLEDGE_PAGE_TARGETS[need] || [];

    targets.push(...pageTypes);
  }

  return uniq(targets);
}


export function buildAdapterPlan({
  pageType = null,
  needs = []
} = {}) {
  return {
    version:
      "KnowledgeAdapterRegistryV1",

    page_type:
      pageType,

    requested_needs:
      uniq(needs),

    block_families:
      getBlockFamiliesForNeeds(
        pageType,
        needs
      ),

    knowledge_page_targets:
      getKnowledgePageTargets(
        needs
      )
  };
}
