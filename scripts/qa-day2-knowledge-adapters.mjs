import fs from "node:fs";

const source =
  fs.readFileSync(
    new URL(
      "../src/knowledge-adapters.js",
      import.meta.url
    ),
    "utf8"
  );

fs.writeFileSync(
  "/tmp/knowledge-adapters.mjs",
  source
);

const {
  getAdapterPageTypes,
  buildAdapterPlan
} = await import(
  "file:///tmp/knowledge-adapters.mjs"
);


function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}


const pageTypes =
  getAdapterPageTypes();

assert(
  pageTypes.length === 12,
  `Expected 12 adapters, got ${pageTypes.length}`
);

console.log(
  `PASS ✅ adapters registered: ${pageTypes.length}`
);


const projectFamily =
  buildAdapterPlan({
    pageType: "project_page",
    needs: [
      "current_page.summary",
      "current_entity.facts",
      "current_entity.buyer_fit",
      "related.district"
    ]
  });

assert(
  projectFamily.block_families.includes(
    "short_answer"
  ),
  "project summary mapping missing"
);

assert(
  projectFamily.block_families.includes(
    "key_facts"
  ),
  "project facts mapping missing"
);

assert(
  projectFamily.block_families.includes(
    "buyer_fit"
  ),
  "project buyer_fit mapping missing"
);

assert(
  projectFamily.block_families.includes(
    "location"
  ),
  "project district/location mapping missing"
);

console.log(
  "PASS ✅ project_page semantic mapping"
);


const comparison =
  buildAdapterPlan({
    pageType:
      "project_comparison_page",

    needs: [
      "comparison.entities",
      "comparison.facts",
      "comparison.tradeoffs"
    ]
  });

assert(
  comparison.block_families.includes(
    "project_summaries_logic"
  ),
  "comparison entities mapping missing"
);

assert(
  comparison.block_families.includes(
    "comparison_facts"
  ),
  "comparison facts mapping missing"
);

assert(
  comparison.block_families.includes(
    "project_comparison_table"
  ),
  "comparison table mapping missing"
);

console.log(
  "PASS ✅ comparison semantic mapping"
);


const recommendation =
  buildAdapterPlan({
    pageType: "project_page",

    needs: [
      "current_entity.buyer_fit",
      "knowledge.buyer_scenario",
      "knowledge.budget",
      "knowledge.intent",
      "knowledge.property_type"
    ]
  });

assert(
  recommendation.knowledge_page_targets
    .includes("buyer_scenario_page"),
  "buyer scenario target missing"
);

assert(
  recommendation.knowledge_page_targets
    .includes("budget_page"),
  "budget target missing"
);

assert(
  recommendation.knowledge_page_targets
    .includes("intent_page"),
  "intent target missing"
);

assert(
  recommendation.knowledge_page_targets
    .includes("property_type_page"),
  "property type target missing"
);

console.log(
  "PASS ✅ cross-page knowledge targets"
);


for (const pageType of pageTypes) {
  const plan =
    buildAdapterPlan({
      pageType,
      needs: [
        "current_page.summary",
        "current_entity.facts",
        "current_entity.risks",
        "current_entity.decision_logic"
      ]
    });

  assert(
    plan.block_families.length > 0,
    `${pageType}: no semantic blocks resolved`
  );
}

console.log(
  "PASS ✅ all 12 adapters resolve semantic knowledge"
);

console.log("");
console.log(
  "DAY 2 / KNOWLEDGE ADAPTER REGISTRY V1 = PASS ✅"
);
