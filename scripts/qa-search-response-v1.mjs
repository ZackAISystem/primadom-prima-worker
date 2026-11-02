import {
  buildSearchRouteResponse
} from "../src/search-response.js";


function check(
  name,
  condition
) {
  if (!condition) {
    throw new Error(name);
  }
}


const search =
  buildSearchRouteResponse({
    route:
      "property_search",

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

        result_count:
          4,

        results: [
          {
            entity_type:
              "project",

            slug:
              "luce-palm-jumeirah",

            rank: 1,

            /*
              Deliberately untrusted display data.
              It must NOT enter cards[].
            */
            title:
              "<script>bad</script>",

            price_display:
              "FAKE PRICE"
          },
          {
            entity_type:
              "project",

            slug:
              "ellington-beach-house",

            rank: 2
          },
          {
            entity_type:
              "project",

            slug:
              "armani-beach-residences",

            rank: 3
          },
          {
            entity_type:
              "project",

            slug:
              "west-residence-at-serenia",

            rank: 4
          }
        ]
      }
    }
  });

check(
  "search_response_missing",
  search?.response_type ===
    "search_results"
);

check(
  "wrong_card_count",
  search.cards.length === 3
);

check(
  "wrong_first_card",
  search.cards[0]?.slug ===
    "luce-palm-jumeirah"
);

check(
  "display_data_leaked",
  !Object.prototype.hasOwnProperty.call(
    search.cards[0],
    "title"
  ) &&
  !Object.prototype.hasOwnProperty.call(
    search.cards[0],
    "price_display"
  )
);


const empty =
  buildSearchRouteResponse({
    route:
      "property_search",

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

        result_count:
          0,

        results: []
      }
    }
  });

check(
  "empty_result_regression",
  empty?.response_type ===
    "search_results" &&
  empty?.cards?.length === 0 &&
  empty?.used_search === true
);


const ordinary =
  buildSearchRouteResponse({
    route:
      "exact_fact",

    context: {
      search: null
    }
  });

check(
  "ordinary_route_cards",
  ordinary === null
);


console.log(
  "PASS ✅ — Search Response V1"
);

console.log(
  "SearchContext → ResponseContract cards ✅"
);

console.log(
  "top 3 entity refs only ✅"
);

console.log(
  "untrusted display fields excluded ✅"
);

console.log(
  "zero results handled ✅"
);
