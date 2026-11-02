import {
  buildPrimaSearchRequest
} from "../src/prima-search-request.js";


function check(
  name,
  condition
) {
  if (!condition) {
    throw new Error(name);
  }
}


const plain =
  buildPrimaSearchRequest({
    route:
      "property_search",

    message:
      "Show me projects under AED 5M",

    context: {
      search: null,

      entity: {
        primary_type: null,
        primary_slug: null
      }
    }
  });

check(
  "plain_search_request_missing",
  plain?.version ===
    "PrimaToolRequestV1" &&
  plain?.tool ===
    "prima_search" &&
  plain?.action ===
    "search_projects" &&
  plain?.query ===
    "Show me projects under AED 5M" &&
  plain?.max_results === 10
);


const contextual =
  buildPrimaSearchRequest({
    route:
      "property_search",

    message:
      "Show me something similar below AED 5M",

    context: {
      search: null,

      entity: {
        primary_type:
          "project",

        primary_slug:
          "passo"
      }
    }
  });

check(
  "current_project_not_resolved",
  contextual?.query ===
    "Show me something similar to Passo below AED 5M"
);


const thisOne =
  buildPrimaSearchRequest({
    route:
      "property_search",

    message:
      "Find something cheaper than this project",

    context: {
      search: null,

      entity: {
        primary_type:
          "project",

        primary_slug:
          "passo"
      }
    }
  });

check(
  "this_project_not_resolved",
  thisOne?.query ===
    "Find something cheaper than Passo"
);


const alreadyResolved =
  buildPrimaSearchRequest({
    route:
      "property_search",

    message:
      "Show me projects under AED 5M",

    context: {
      search: {
        version:
          "SearchContextV1",

        language:
          "en",

        entity_type:
          "project",

        state:
          "results",

        results: [
          {
            slug: "passo"
          }
        ]
      }
    }
  });

check(
  "resolved_search_loop",
  alreadyResolved === null
);


const emptyResolved =
  buildPrimaSearchRequest({
    route:
      "property_search",

    message:
      "Show me projects under AED 1",

    context: {
      search: {
        version:
          "SearchContextV1",

        language:
          "en",

        entity_type:
          "project",

        state:
          "empty",

        results: []
      }
    }
  });

check(
  "empty_search_loop",
  emptyResolved === null
);


const ordinary =
  buildPrimaSearchRequest({
    route:
      "exact_fact",

    message:
      "When is Passo handover?",

    context: {}
  });

check(
  "ordinary_route_triggered_search",
  ordinary === null
);


console.log(
  "PASS ✅ — Prima Search Request V1"
);

console.log(
  "property_search → prima_search ✅"
);

console.log(
  "current project → Search anchor ✅"
);

console.log(
  "resolved SearchContext → no loop ✅"
);

console.log(
  "empty SearchContext → no loop ✅"
);

console.log(
  "ordinary routes → no Search ✅"
);
