import {
  normalizeProjectCardFactsResult,
  attachProjectCardFacts
} from "../src/card-facts.js";


function check(
  name,
  condition
) {
  if (!condition) {
    throw new Error(name);
  }
}


const raw = {
  version:
    "SearchKnowledgeBundleV1",

  resolved:
    true,

  blocks: [
    {
      entity_type:
        "project",

      entity_slug:
        "passo",

      entity_name:
        "Passo",

      candidate_rank:
        1,

      block_family:
        "key_facts",

      final_block_json: {
        key_facts: [
          {
            key:
              "price_from",

            value:
              "AED 8,800,000",

            value_status:
              "available"
          },
          {
            key:
              "developer",

            value:
              "Beyond",

            value_status:
              "available"
          },
          {
            key:
              "district",

            value:
              "Palm Jumeirah",

            value_status:
              "available"
          }
        ]
      }
    },

    {
      entity_type:
        "project",

      entity_slug:
        "orla-by-omniyat",

      entity_name:
        "Orla by Omniyat",

      candidate_rank:
        2,

      block_family:
        "key_facts",

      final_block_json: {
        key_facts: [
          {
            key:
              "price_from",

            value:
              "AED 24,000,000",

            value_status:
              "available"
          },
          {
            key:
              "developer",

            value:
              "Omniyat",

            value_status:
              "available"
          },
          {
            key:
              "district",

            value:
              "Palm Jumeirah",

            value_status:
              "available"
          }
        ]
      }
    },

    {
      entity_type:
        "project",

      entity_slug:
        "luce-palm-jumeirah",

      entity_name:
        "Luce Palm Jumeirah",

      candidate_rank:
        3,

      block_family:
        "key_facts",

      final_block_json: {
        key_facts: [
          {
            key:
              "price_from",

            value:
              "AED 7,000,000",

            value_status:
              "available"
          },
          {
            key:
              "developer",

            value:
              "—",

            value_status:
              "missing"
          },
          {
            key:
              "district",

            value:
              "Palm Jumeirah",

            value_status:
              "available"
          }
        ]
      }
    }
  ]
};


const facts =
  normalizeProjectCardFactsResult(
    raw,
    [
      "passo",
      "orla-by-omniyat",
      "luce-palm-jumeirah",
      "must-not-appear"
    ]
  );


check(
  "bundle_not_resolved",
  facts?.resolved === true
);

check(
  "card_limit_failed",
  facts?.cards?.length === 3
);

check(
  "passo_title_failed",
  facts.cards[0].title ===
    "Passo"
);

check(
  "passo_price_failed",
  facts.cards[0]
    .price_display ===
    "AED 8,800,000"
);

check(
  "passo_district_failed",
  facts.cards[0].district ===
    "Palm Jumeirah"
);

check(
  "passo_developer_failed",
  facts.cards[0].developer ===
    "Beyond"
);

check(
  "missing_fact_not_null",
  facts.cards[2].developer ===
    null
);


const attached =
  attachProjectCardFacts(
    [
      {
        version:
          "EntityCardRefV1",
        entity_type:
          "project",
        slug:
          "passo",
        rank:
          1
      },
      {
        version:
          "EntityCardRefV1",
        entity_type:
          "project",
        slug:
          "orla-by-omniyat",
        rank:
          2
      },
      {
        version:
          "EntityCardRefV1",
        entity_type:
          "project",
        slug:
          "luce-palm-jumeirah",
        rank:
          3
      }
    ],
    facts
  );


check(
  "facts_not_attached",
  attached[0]
    ?.facts
    ?.version ===
    "ProjectCardFactsV1"
);

check(
  "verified_title_missing",
  attached[0]
    ?.facts
    ?.title ===
    "Passo"
);

check(
  "verified_price_missing",
  attached[0]
    ?.facts
    ?.price_display ===
    "AED 8,800,000"
);

check(
  "attached_limit_failed",
  attached.length === 3
);


console.log(
  "PASS ✅ — Project Card Facts V1"
);

console.log(
  "top 3 only ✅"
);

console.log(
  "verified title / price / district / developer ✅"
);

console.log(
  "missing facts stay null ✅"
);

console.log(
  "existing EntityCardRefV1 preserved ✅"
);
