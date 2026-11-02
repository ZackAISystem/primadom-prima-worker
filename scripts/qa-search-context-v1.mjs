import {
  normalizeSearchContextV1
} from "../src/search-context.js";

import {
  buildLocalContextEnvelope
} from "../src/context.js";

import {
  buildEvidencePack
} from "../src/evidence-pack.js";

function check(name, condition) {
  if (!condition) {
    throw new Error(name);
  }
}

const raw = {
  version: "SearchContextV1",
  language: "en",
  entity_type: "project",
  query:
    "2 bedroom apartment in Dubai Hills under AED 5M",

  state: "results",

  filters: {
    emirates: ["Dubai"],
    district: "Dubai Hills",
    property_types: ["Apartment"],
    bedrooms: [2],

    budget: {
      max: 5000000
    }
  },

  result_count: 25,

  results:
    Array.from(
      { length: 12 },
      (_, i) => ({
        score: 100 - i,
        slug: `project-${i + 1}`,
        canonical_url:
          `/en/projects/project-${i + 1}/`,
        title: `Project ${i + 1}`,
        district: "Dubai Hills",
        developer: "Developer",
        price_display:
          "AED 5,000,000",
        price_amount: 5000000,
        property_type: "Apartment",
        units: "2 BR",
        status: "Off-plan",

        search_terms:
          "MUST_NOT_SURVIVE"
      })
    ),

  malicious_extra:
    "MUST_NOT_SURVIVE"
};

const normalized =
  normalizeSearchContextV1(raw);

check(
  "normalization_failed",
  normalized !== null
);

check(
  "top10_failed",
  normalized.results.length === 10
);

check(
  "rank_failed",
  normalized.results[0].rank === 1
);

check(
  "filter_failed",
  normalized.filters.bedrooms[0] === 2
);

check(
  "untrusted_fields_leaked",
  !JSON.stringify(normalized)
    .includes("MUST_NOT_SURVIVE")
);

check(
  "non_en_accepted",
  normalizeSearchContextV1({
    ...raw,
    language: "ru"
  }) === null
);

const context =
  buildLocalContextEnvelope(
    {
      page: {
        language_code: "en"
      },

      search_context: raw
    },
    "Which one is better for me?",
    []
  );

check(
  "context_missing_search",
  context.search?.results?.length === 10
);

const noSearchContext =
  buildLocalContextEnvelope(
    {
      page: {
        language_code: "en"
      }
    },
    "Hello",
    []
  );

check(
  "ordinary_context_search",
  noSearchContext.search === null
);

const knowledge = {
  page: null,
  blocks: [],
  relations: [],

  related_knowledge: {
    blocks: []
  }
};

const pack =
  buildEvidencePack({
    route: "recommendation",
    message:
      "Which one is better for me?",
    context,
    knowledgePack: knowledge
  });

check(
  "evidence_missing_search",
  pack.search_context
    ?.results
    ?.length === 10
);

const plainPack =
  buildEvidencePack({
    route: "recommendation",
    message: "Hello",
    context: noSearchContext,
    knowledgePack: knowledge
  });

check(
  "ordinary_evidence_search",
  !Object.prototype
    .hasOwnProperty.call(
      plainPack,
      "search_context"
    )
);

console.log(
  "PASS ✅ — SearchContextV1 worker integration"
);

console.log(
  "EN-only + top 10 ✅"
);

console.log(
  "Untrusted browser fields stripped ✅"
);

console.log(
  "No SearchContext → zero Search payload ✅"
);
