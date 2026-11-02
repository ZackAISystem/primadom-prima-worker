const MAX_CARDS = 3;


function validSearch(
  context
) {
  const search =
    context?.search;

  if (
    search?.version !==
      "SearchContextV1" ||
    search?.language !== "en" ||
    search?.entity_type !==
      "project"
  ) {
    return null;
  }

  if (
    search.state !== "results" &&
    search.state !== "empty"
  ) {
    return null;
  }

  return search;
}


// F21_RECOMMENDATION_DYNAMIC_CARDS_1_TO_10
// Preserve Block D Search and its three-card pagination.
function recommendationPageSize(search, route) {
  if (route !== "recommendation") {
    return MAX_CARDS;
  }

  const requested = Number(search?.requested_count);

  return Number.isInteger(requested) &&
    requested >= 1 &&
    requested <= 10
      ? requested
      : MAX_CARDS;
}

function cardRefs(
  search,
  route
) {
  const results =
    Array.isArray(
      search?.results
    )
      ? search.results
      : [];

  const offset =
    Number.isInteger(
      search?.current_batch_offset
    )
      ? search.current_batch_offset
      : 0;

  return results
    .slice(
      offset,
      offset + recommendationPageSize(search, route)
    )
    .filter(
      item =>
        item?.entity_type ===
          "project" &&
        item?.slug
    )
    .map(
      (item, index) => ({
        version:
          "EntityCardRefV1",

        entity_type:
          "project",

        slug:
          String(
            item.slug
          ),

          canonical_url:
            String(
              item.canonical_url || ""
            ),

          gallery_1:
            String(
              item.gallery_1 || ""
            ),

          image_alt:
            String(
              item.image_alt ||
              item.title ||
              ""
            ),

        rank:
          Number(
            item.rank ||
            index + 1
          )
      })
    );
}


// BLOCK_D_VERIFIED_ENTITY_SEARCH_RESPONSE_V5
// Reuse the canonical normalized D4/D5 SearchContext identity. This is a
// generic entity response contract, never a canned answer to a phrase.
// Existing project Search and advisory/recommendation logic is untouched.
function buildVerifiedEntitySearchResponseV5(search) {
  if (
    search?.version !== "SearchContextV1" ||
    search?.source !== "prima_ui_verified_entity_batch_v1" ||
    search?.language !== "en" ||
    search?.state !== "results" ||
    !["developer", "district"].includes(search?.entity_type) ||
    !Array.isArray(search.results) ||
    search.results.length < 1 ||
    search.results.length > 90 ||
    !Number.isInteger(search.current_batch_offset) ||
    search.current_batch_offset < 0 ||
    search.current_batch_offset >= search.results.length
  ) return null;

  const type = search.entity_type;
  const prefix = type === "district" ? "/en/areas/" : "/en/developers/";
  if (!search.results.every(item =>
    item?.entity_type === type &&
    typeof item.slug === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) &&
    item.canonical_url === prefix + item.slug + "/" &&
    typeof item.title === "string" &&
    item.title.trim().length > 0 &&
    item.title.length <= 200
  )) return null;

  const offset = search.current_batch_offset;
  const selected = search.results.slice(offset, offset + MAX_CARDS);
  const count = Number.isInteger(search.result_count) &&
    search.result_count >= search.results.length
      ? search.result_count : search.results.length;

  const cards = selected.map((item, index) => ({
    version: "EntityCardRefV1",
    entity_type: type,
    slug: item.slug,
    canonical_url: item.canonical_url,
    gallery_1: "",
    image_alt: item.title,
    rank: offset + index + 1
  }));

  const nextOffset = offset + selected.length;
  const hasMore = nextOffset < search.results.length;
  const singular = type === "district" ? "district" : "developer";
  const plural = type === "district" ? "districts" : "developers";
  // A validated Registry identity supports its name and page URL, but not
  // unsupported investment claims, prices, or descriptive profile facts.
  const answer = count === 1
    ? `I found ${search.results[0].title} in the Primadom ${singular} directory.`
    : `I found ${count} ${plural} in the Primadom directory. Here are ${cards.length} verified matches.`;

  return {
    response_type: "search_results",
    answer,
    cards,
    pagination: {
      version: "SearchPaginationV1",
      current_offset: offset,
      next_offset: hasMore ? nextOffset : null,
      has_more: hasMore,
      available_results: search.results.length,
      total_results: count
    },
    used_search: true
  };
}

export function buildSearchRouteResponse({
  route = null,
  context = null
} = {}) {
  if (
    route !==
      "property_search" &&
    route !==
      "recommendation"
  ) {
    return null;
  }

  // D4/D5 complete verified entity Search without a generic fallback.
  // Recommendation remains on its existing, independent path.
  if (
    route === "property_search" &&
    ["developer", "district"].includes(context?.search?.entity_type)
  ) {
    return buildVerifiedEntitySearchResponseV5(context.search);
  }

  const search =
    validSearch(
      context
    );

  if (!search) {
    return null;
  }

  const cards = cardRefs(search, route);

  if (
    search.state === "empty" ||
    cards.length === 0
  ) {
    return {
      response_type:
        "search_results",

      answer:
        "I couldn't find an exact project match for those conditions. We can broaden one of the criteria and try again.",

      cards: [],

      used_search:
        true
    };
  }

  const total =
    Number.isFinite(
      Number(
        search.result_count
      )
    )
      ? Number(
          search.result_count
        )
      : cards.length;

  const availableResults =
    Array.isArray(
      search?.results
    )
      ? search.results.length
      : 0;

  const currentOffset =
    Number.isInteger(
      search?.current_batch_offset
    )
      ? search.current_batch_offset
      : 0;

  const candidateNextOffset =
    currentOffset +
    recommendationPageSize(search, route);

  // C_D_D5_REMOTE_PAGINATION_V9: D5 delivers 3 verified projects per
  // endpoint page. A positive remote has_more must not be hidden just
  // because only 3 rows were attached to this Worker continuation.
  // Search V3 and recommendation pagination remain byte-for-byte intact.
  const verifiedD5Page =
    route === "property_search" &&
    search.verified_d5_page &&
    search.verified_d5_page.next_offset ===
      currentOffset + cards.length
      ? search.verified_d5_page
      : null;

  const hasMore = verifiedD5Page
    ? verifiedD5Page.has_more
    : candidateNextOffset < availableResults;

  const pagination = {
    version:
      "SearchPaginationV1",

    current_offset:
      currentOffset,

    next_offset:
      hasMore
        ? (verifiedD5Page
            ? verifiedD5Page.next_offset
            : candidateNextOffset)
        : null,

    has_more:
      hasMore,

    // Explicit provenance prevents interpreting D5 remote continuation
    // as a promise that the next page is in the attached results array.
    ...(verifiedD5Page
      ? {pagination_source: "verified_d5_remote"}
      : {}),

    available_results:
      availableResults,

    total_results:
      total
  };


  const countLabel =
    total === 1
      ? "1 project"
      : `${total} projects`;

  const shownLabel =
    currentOffset > 0
      ? (
          cards.length === 1
            ? "the next match"
            : (
                cards.length === 2
                  ? "the next two matches"
                  : "the next three matches"
              )
        )
      : (
          cards.length === 1
            ? "the strongest match"
            : (
                cards.length === 2
                  ? "the two strongest matches"
                  : "the three strongest matches"
              )
        );

  /*
    Recommendation keeps the same real cards,
    but Knowledge + Memory + Persona produce
    the explanatory answer later.
  */
  if (
    route === "recommendation"
  ) {
    return {
      response_type:
        "search_results",

      answer:
        null,

      cards,

      pagination,

      used_search:
        true
    };
  }

  const more =
    hasMore
      ? " I can show you a few more options if you'd like."
      : "";

  return {
    response_type:
      "search_results",

    answer:
      `I found ${countLabel} matching your search. Here are ${shownLabel}.${more}`,

    cards,

    pagination,

    used_search:
      true
  };
}
