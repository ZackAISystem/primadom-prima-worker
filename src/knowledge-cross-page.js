import {
  supabaseRpc,
  supabaseSelect
} from "./supabase.js";

import {
  buildAdapterPlan
} from "./knowledge-adapters.js";


function uniq(values = []) {
  return [...new Set(
    values.filter(Boolean)
  )];
}


function scenarioMeta(row = {}) {
  return row?.metadata || row || {};
}


function numericValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function numericFit(row = {}) {
  const meta =
    scenarioMeta(row);

  return (
    numericValue(
      meta.scenario_fit_score
    ) || 0
  );
}


function parseMoney(value) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value === "string") {
    const text =
      value
        .toLowerCase()
        .replace(/,/g, "")
        .trim();

    const match =
      text.match(
        /([0-9]+(?:\.[0-9]+)?)\s*(m|million|k|thousand)?/
      );

    if (!match) {
      return null;
    }

    let amount =
      Number(match[1]);

    if (!Number.isFinite(amount)) {
      return null;
    }

    if (
      match[2] === "m" ||
      match[2] === "million"
    ) {
      amount *= 1000000;
    }

    if (
      match[2] === "k" ||
      match[2] === "thousand"
    ) {
      amount *= 1000;
    }

    return amount;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const candidates = [
      value.amount,
      value.value,
      value.max,
      value.max_aed,
      value.budget,
      value.budget_aed
    ];

    for (const candidate of candidates) {
      const parsed =
        parseMoney(candidate);

      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}


function getClientBudgetAed(
  context = {}
) {
  const facts =
    context?.memory?.active_facts || [];

  for (const fact of facts) {
    const key =
      String(
        fact?.fact_key || ""
      ).toLowerCase();

    if (!key.includes("budget")) {
      continue;
    }

    const parsed =
      parseMoney(
        fact?.fact_value
      );

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}


function getMemoryValue(
  context = {},
  key
) {
  const facts =
    context?.memory?.active_facts || [];

  return facts.find(
    item =>
      item?.fact_key === key
  )?.fact_value ?? null;
}


export function scoreBuyerScenario(
  row,
  planner,
  context = {}
) {
  const meta =
    scenarioMeta(row);

  const topics =
    planner?.topics || [];

  const goal =
    String(
      meta.buyer_goal || ""
    ).toLowerCase();

  const persona =
    String(
      meta.buyer_persona || ""
    ).toLowerCase();

  const group =
    String(
      meta.scenario_group || ""
    ).toLowerCase();

  const name =
    String(
      meta.scenario_name || ""
    ).toLowerCase();

  const budgetMin =
    numericValue(
      meta.budget_min_aed
    );

  const budgetMax =
    numericValue(
      meta.budget_max_aed
    );

  const clientBudget =
    getClientBudgetAed(
      context
    );

  let score = 0;


  // -------------------------------------------------------
  // FAMILY / OWN USE / LIFESTYLE
  // -------------------------------------------------------

  if (
    topics.includes(
      "family_living"
    )
  ) {
    if (goal === "family_living") {
      score += 90;
    }

    if (persona === "family_buyer") {
      score += 50;
    }

    if (
      group.includes("family")
    ) {
      score += 30;
    }

    if (
      goal === "waterfront_lifestyle"
    ) {
      score += 60;
    }

    if (goal === "second_home") {
      score += 35;
    }

    if (goal === "luxury_living") {
      score += 20;
    }

    if (
      persona === "lifestyle_buyer"
    ) {
      score += 30;
    }

    if (
      persona === "second_home_buyer"
    ) {
      score += 20;
    }

    if (group === "waterfront") {
      score += 25;
    }

    if (group === "second home") {
      score += 15;
    }

    if (
      persona === "investor" ||
      group === "investment" ||
      group === "rental income"
    ) {
      score -= 60;
    }

    if (
      getMemoryValue(
        context,
        "children_count"
      ) !== null
    ) {
      if (
        goal === "family_living"
      ) {
        score += 15;
      }

      if (
        goal ===
          "waterfront_lifestyle" ||
        persona ===
          "lifestyle_buyer"
      ) {
        score += 10;
      }
    }

    // A narrow budget scenario should not
    // hijack a generic family question.
    if (
      budgetMax !== null &&
      clientBudget === null
    ) {
      score -= 120;
    }
  }


  // -------------------------------------------------------
  // INVESTMENT
  // -------------------------------------------------------

  if (
    topics.includes("investment")
  ) {
    if (goal === "rental_income") {
      score += 60;
    }

    if (
      goal === "short_term_rental"
    ) {
      score += 50;
    }

    if (
      goal === "wealth_preservation"
    ) {
      score += 35;
    }

    if (persona === "investor") {
      score += 30;
    }

    if (
      group === "investment" ||
      group === "rental income"
    ) {
      score += 25;
    }
  }


  // -------------------------------------------------------
  // FINANCING
  // -------------------------------------------------------

  if (
    topics.includes("financing")
  ) {
    if (goal === "payment_plan") {
      score += 70;
    }

    if (
      name.includes("payment plan")
    ) {
      score += 30;
    }
  }


  // -------------------------------------------------------
  // BUDGET
  // -------------------------------------------------------

  if (topics.includes("budget")) {
    if (goal === "budget_fit") {
      score += 60;
    }

    if (group === "budget") {
      score += 30;
    }
  }


  // -------------------------------------------------------
  // CLIENT BUDGET COMPATIBILITY
  // -------------------------------------------------------

  if (clientBudget !== null) {
    if (
      budgetMin !== null &&
      clientBudget < budgetMin
    ) {
      score -= 200;
    }

    if (
      budgetMax !== null &&
      clientBudget > budgetMax
    ) {
      score -= 200;
    }
  }


  // -------------------------------------------------------
  // DECISION STAGE
  // -------------------------------------------------------

  if (
    planner?.route === "compare" ||
    planner?.route ===
      "recommendation"
  ) {
    if (
      goal === "compare_options"
    ) {
      score += 25;
    }
  }


  // Fit score is only a tie-breaker.
  score += Math.min(
    numericFit(row) / 10000,
    10
  );

  return score;
}


export function chooseBuyerScenario(
  rows = [],
  planner,
  context = {}
) {
  const ranked =
    rows
      .map(row => ({
        row,
        semantic_score:
          scoreBuyerScenario(
            row,
            planner,
            context
          )
      }))
      .sort(
        (a, b) =>
          b.semantic_score -
          a.semantic_score
      );

  const best =
    ranked[0] || null;

  if (
    !best ||
    best.semantic_score <= 10
  ) {
    return null;
  }

  return {
    ...best.row,

    semantic_score:
      best.semantic_score
  };
}


function districtNeedsForPlanner(
  planner
) {
  const topics =
    planner?.topics || [];

  const needs = [
    "current_page.summary",
    "current_entity.facts"
  ];

  if (
    topics.includes(
      "family_living"
    )
  ) {
    needs.push(
      "current_entity.buyer_fit",
      "current_entity.decision_logic"
    );
  }

  if (
    topics.includes("investment")
  ) {
    needs.push(
      "current_entity.investment_logic",
      "current_entity.decision_logic"
    );
  }

  if (topics.includes("risk")) {
    needs.push(
      "current_entity.risks",
      "current_entity.decision_logic"
    );
  }

  return uniq(needs);
}


function buyerScenarioNeeds() {
  return [
    "current_page.summary",
    "current_entity.facts",
    "current_entity.buyer_fit",
    "current_entity.decision_logic"
  ];
}


export function getDistrictBundleFamilies(
  planner
) {
  const needsDistrict =
    planner?.needs?.includes(
      "related.district"
    ) ||
    planner?.needs?.includes(
      "related.entities"
    );

  if (!needsDistrict) {
    return [];
  }

  const adapter =
    buildAdapterPlan({
      pageType:
        "district_page",

      needs:
        districtNeedsForPlanner(
          planner
        )
    });

  return Array.isArray(
    adapter?.block_families
  )
    ? adapter.block_families
    : [];
}


export function resolveCrossPageKnowledgeFromBundle(
  bundle,
  context,
  planner
) {
  const startedAt =
    Date.now();

  const result = {
    version:
      "CrossPageKnowledgeV1-BUNDLE",

    relations: [],
    pages: [],
    blocks: [],

    selected_buyer_scenario:
      null,

    meta: {
      database_calls: 0,
      latency_ms: 0
    }
  };


  const primaryType =
    context?.entity?.primary_type;

  const primarySlug =
    context?.entity?.primary_slug;


  if (
    primaryType !== "project" ||
    !primarySlug
  ) {
    result.meta.latency_ms =
      Date.now() - startedAt;

    return result;
  }


  const relation =
    bundle?.relation || null;

  if (relation) {
    result.relations = [
      relation
    ];
  }


  const districtPage =
    bundle?.district_page || null;


  const scenarioRows =
    Array.isArray(
      bundle?.buyer_scenarios
    )
      ? bundle.buyer_scenarios
      : [];


  const needsDistrict =
    planner?.needs?.includes(
      "related.district"
    ) ||
    planner?.needs?.includes(
      "related.entities"
    );


  const needsScenario =
    planner?.needs?.includes(
      "knowledge.buyer_scenario"
    );


  const selectedScenario =
    needsScenario
      ? chooseBuyerScenario(
          scenarioRows,
          planner,
          context
        )
      : null;


  if (selectedScenario) {
    const meta =
      scenarioMeta(
        selectedScenario
      );

    result.selected_buyer_scenario = {
      page_id:
        selectedScenario.page_id,

      url_path:
        selectedScenario.url_path,

      scenario_name:
        meta.scenario_name || null,

      buyer_goal:
        meta.buyer_goal || null,

      buyer_persona:
        meta.buyer_persona || null,

      budget_min_aed:
        numericValue(
          meta.budget_min_aed
        ),

      budget_max_aed:
        numericValue(
          meta.budget_max_aed
        ),

      semantic_score:
        selectedScenario
          .semantic_score
    };
  }


  const districtAdapter =
    needsDistrict &&
    districtPage
      ? buildAdapterPlan({
          pageType:
            "district_page",

          needs:
            districtNeedsForPlanner(
              planner
            )
        })
      : null;


  const scenarioAdapter =
    selectedScenario
      ? buildAdapterPlan({
          pageType:
            "buyer_scenario_page",

          needs:
            buyerScenarioNeeds()
        })
      : null;


  const districtBlocks =
    districtAdapter &&
    districtPage &&
    Array.isArray(
      bundle?.district_blocks
    )
      ? bundle.district_blocks
      : [];


  if (
    districtAdapter &&
    districtPage
  ) {
    result.pages.push({
      role:
        "related_district",

      page:
        districtPage,

      adapter:
        districtAdapter,

      blocks_loaded:
        districtBlocks.length
    });
  }


  if (
    scenarioAdapter &&
    selectedScenario
  ) {
    result.pages.push({
      role:
        "buyer_scenario",

      page: {
        page_id:
          selectedScenario.page_id,

        page_type_id:
          selectedScenario
            .page_type_id,

        url_path:
          selectedScenario.url_path
      },

      adapter:
        scenarioAdapter,

      blocks_loaded: 0
    });
  }


  result.blocks = [
    ...districtBlocks.map(
      block => ({
        ...block,

        knowledge_role:
          "related_district"
      })
    )
  ];


  result.meta.latency_ms =
    Date.now() - startedAt;


  return result;
}



export async function resolveCrossPageKnowledge(
  env,
  context,
  planner
) {
  const startedAt =
    Date.now();

  const result = {
    version:
      "CrossPageKnowledgeV1-OPTIMIZED",

    relations: [],
    pages: [],
    blocks: [],

    selected_buyer_scenario:
      null,

    meta: {
      database_calls: 0,
      latency_ms: 0
    }
  };


  const primaryType =
    context?.entity?.primary_type;

  const primarySlug =
    context?.entity?.primary_slug;

  if (
    primaryType !== "project" ||
    !primarySlug
  ) {
    result.meta.latency_ms =
      Date.now() - startedAt;

    return result;
  }


  // -------------------------------------------------------
  // ONE RPC:
  // relation + district identity + scenario candidates
  // -------------------------------------------------------

  const candidates =
    await supabaseRpc(
      env,
      "resolve_cross_page_candidates_v1",
      {
        p_project_slug:
          primarySlug,

        p_language_code:
          context?.page
            ?.language_code || "en"
      }
    );

  result.meta.database_calls += 1;


  const relation =
    candidates?.relation || null;

  if (relation) {
    result.relations = [
      relation
    ];
  }


  const districtPage =
    candidates
      ?.district_page || null;

  const scenarioRows =
    Array.isArray(
      candidates
        ?.buyer_scenarios
    )
      ? candidates.buyer_scenarios
      : [];


  const needsDistrict =
    planner?.needs?.includes(
      "related.district"
    ) ||
    planner?.needs?.includes(
      "related.entities"
    );

  const needsScenario =
    planner?.needs?.includes(
      "knowledge.buyer_scenario"
    );


  const selectedScenario =
    needsScenario
      ? chooseBuyerScenario(
          scenarioRows,
          planner,
          context
        )
      : null;


  if (selectedScenario) {
    const meta =
      scenarioMeta(
        selectedScenario
      );

    result.selected_buyer_scenario = {
      page_id:
        selectedScenario.page_id,

      url_path:
        selectedScenario.url_path,

      scenario_name:
        meta.scenario_name || null,

      buyer_goal:
        meta.buyer_goal || null,

      buyer_persona:
        meta.buyer_persona || null,

      budget_min_aed:
        numericValue(
          meta.budget_min_aed
        ),

      budget_max_aed:
        numericValue(
          meta.budget_max_aed
        ),

      semantic_score:
        selectedScenario
          .semantic_score
    };
  }


  const districtAdapter =
    needsDistrict &&
    districtPage
      ? buildAdapterPlan({
          pageType:
            "district_page",

          needs:
            districtNeedsForPlanner(
              planner
            )
        })
      : null;


  const scenarioAdapter =
    selectedScenario
      ? buildAdapterPlan({
          pageType:
            "buyer_scenario_page",

          needs:
            buyerScenarioNeeds()
        })
      : null;


  const pageIds =
    uniq([
      districtAdapter
        ? districtPage?.page_id
        : null,

      scenarioAdapter
        ? selectedScenario?.page_id
        : null
    ]);


  const families =
    uniq([
      ...(
        districtAdapter
          ?.block_families || []
      ),

      ...(
        scenarioAdapter
          ?.block_families || []
      )
    ]);


  let allBlocks = [];


  // -------------------------------------------------------
  // ONE SELECT FOR BOTH RELATED PAGES
  // -------------------------------------------------------

  if (
    pageIds.length > 0 &&
    families.length > 0
  ) {
    const pageFilter =
      pageIds
        .map(value =>
          encodeURIComponent(value)
        )
        .join(",");

    const familyFilter =
      families
        .map(value =>
          encodeURIComponent(value)
        )
        .join(",");

    allBlocks =
      await supabaseSelect(
        env,
        "knowledge_blocks_v1",
        [
          "select=page_id,block_key,block_index,block_family,final_block_json,content_version_id",
          `page_id=in.(${pageFilter})`,
          `block_family=in.(${familyFilter})`,
          "order=block_index.asc",
          "limit=20"
        ].join("&")
      );

    result.meta.database_calls += 1;
  }


  const districtBlocks =
    districtPage
      ? allBlocks.filter(
          block =>
            block.page_id ===
            districtPage.page_id
        )
      : [];


  const scenarioBlocks =
    selectedScenario
      ? allBlocks.filter(
          block =>
            block.page_id ===
            selectedScenario.page_id
        )
      : [];


  if (
    districtAdapter &&
    districtPage
  ) {
    result.pages.push({
      role:
        "related_district",

      page:
        districtPage,

      adapter:
        districtAdapter,

      blocks_loaded:
        districtBlocks.length
    });
  }


  if (
    scenarioAdapter &&
    selectedScenario
  ) {
    result.pages.push({
      role:
        "buyer_scenario",

      page: {
        page_id:
          selectedScenario.page_id,

        page_type_id:
          selectedScenario
            .page_type_id,

        url_path:
          selectedScenario.url_path
      },

      adapter:
        scenarioAdapter,

      blocks_loaded:
        scenarioBlocks.length
    });
  }


  result.blocks = [
    ...districtBlocks.map(
      block => ({
        ...block,
        knowledge_role:
          "related_district"
      })
    ),

    ...scenarioBlocks.map(
      block => ({
        ...block,
        knowledge_role:
          "buyer_scenario"
      })
    )
  ];


  result.meta.latency_ms =
    Date.now() - startedAt;

  return result;
}
