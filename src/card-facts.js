import {
  supabaseRpc
} from "./supabase.js";


const MAX_CARDS = 3;


function text(
  value,
  limit = 180
) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return "";
  }

  return String(value)
    .trim()
    .slice(0, limit);
}


function searchSlugs(
  context
) {
  const search =
    context?.search;

  if (
    search?.version !==
      "SearchContextV1" ||
    search?.language !== "en" ||
    search?.entity_type !==
      "project" ||
    search?.state !==
      "results"
  ) {
    return [];
  }

  const results =
    Array.isArray(
      search.results
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
      offset + MAX_CARDS
    )
    .filter(
      item =>
        item?.entity_type ===
          "project" &&
        item?.slug
    )
    .map(
      item =>
        text(
          item.slug,
          160
        )
    )
    .filter(Boolean);
}


function finalJson(
  value
) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    try {
      const parsed =
        JSON.parse(value);

      if (
        parsed &&
        typeof parsed ===
          "object" &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }
    } catch {}
  }

  return {};
}


function keyFact(
  json,
  keys
) {
  const facts =
    Array.isArray(
      json?.key_facts
    )
      ? json.key_facts
      : [];

  const accepted =
    new Set(keys);

  const fact =
    facts.find(
      item =>
        item &&
        accepted.has(
          text(
            item.key,
            80
          )
        )
    );

  if (!fact) {
    return null;
  }

  const status =
    text(
      fact.value_status,
      50
    ).toLowerCase();

  if (status === "missing") {
    return null;
  }

  const value =
    text(
      fact.value,
      180
    );

  if (
    !value ||
    value === "—" ||
    value === "-" ||
    value === "–"
  ) {
    return null;
  }

  return value;
}


function buildBundle(
  blocks,
  requestedSlugs
) {
  const slugs =
    requestedSlugs
      .slice(
        0,
        MAX_CARDS
      )
      .map(
        slug =>
          text(
            slug,
            160
          )
      )
      .filter(Boolean);

  const allowed =
    new Set(slugs);

  const bySlug =
    new Map();

  for (
    const block
    of Array.isArray(blocks)
      ? blocks
      : []
  ) {
    const slug =
      text(
        block?.entity_slug,
        160
      );

    if (
      !slug ||
      !allowed.has(slug) ||
      bySlug.has(slug) ||
      text(
        block?.block_family,
        80
      ) !== "key_facts"
    ) {
      continue;
    }

    const json =
      finalJson(
        block.final_block_json
      );

    bySlug.set(
      slug,
      {
        entity_type:
          "project",

        slug,

        rank:
          Number(
            block.candidate_rank ||
            slugs.indexOf(slug) + 1
          ),

        title:
          text(
            block.entity_name,
            180
          ) || null,

        price_display:
          keyFact(
            json,
            [
              "price_from",
              "price"
            ]
          ),

        district:
          keyFact(
            json,
            [
              "district"
            ]
          ),

        developer:
          keyFact(
            json,
            [
              "developer"
            ]
          )
      }
    );
  }

  const cards =
    slugs
      .map(
        slug =>
          bySlug.get(slug)
      )
      .filter(Boolean);

  return {
    version:
      "ProjectCardFactsBundleV1",

    language:
      "en",

    entity_type:
      "project",

    resolved:
      cards.length > 0,

    candidate_count:
      cards.length,

    cards
  };
}


export function normalizeProjectCardFactsResult(
  raw,
  requestedSlugs = []
) {
  if (
    !raw ||
    raw.version !==
      "SearchKnowledgeBundleV1"
  ) {
    return null;
  }

  return buildBundle(
    raw.blocks,
    requestedSlugs
  );
}


export async function resolveProjectCardFacts(
  env,
  context
) {
  const slugs =
    searchSlugs(
      context
    );

  if (!slugs.length) {
    return null;
  }

  /*
    This is NOT another Search and does not run
    the Knowledge Planner.

    Search already selected the projects.
    We request only verified key_facts for the
    maximum three cards shown in Prima Dialog.
  */
  let raw;
  try {
    raw = await supabaseRpc(
      env,
      "resolve_search_project_knowledge_v1",
      {
        p_project_slugs:
          slugs,

        p_language_code:
          "en",

        p_families: [
          "key_facts"
        ]
      }
    );
  } catch (error) {
    // The search result already contains verified project identities.
    // Optional card-fact enrichment must not turn valid Search results
    // into HTTP 500 when its Supabase RPC times out or is unavailable.
    console.warn(
      "d3_optional_card_facts_unavailable",
      String(error?.message || error).slice(0, 240)
    );
    return null;
  }

  return normalizeProjectCardFactsResult(
    raw,
    slugs
  );
}


export function projectCardFactsFromSearchKnowledge(
  searchKnowledge
) {
  if (
    !searchKnowledge?.resolved ||
    !Array.isArray(
      searchKnowledge?.blocks
    )
  ) {
    return null;
  }

  const slugs =
    Array.isArray(
      searchKnowledge
        .candidate_slugs
    )
      ? searchKnowledge
          .candidate_slugs
          .slice(
            0,
            MAX_CARDS
          )
      : [];

  if (!slugs.length) {
    return null;
  }

  /*
    Recommendation already loaded SearchKnowledge.
    Reuse its verified key_facts instead of making
    a second Supabase request.
  */
  return buildBundle(
    searchKnowledge.blocks,
    slugs
  );
}


export function attachProjectCardFacts(
  cardRefs,
  cardFacts
) {
  const cards =
    Array.isArray(
      cardFacts?.cards
    )
      ? cardFacts.cards
      : [];

  const bySlug =
    new Map(
      cards.map(
        item => [
          item.slug,
          item
        ]
      )
    );

  return (
    Array.isArray(cardRefs)
      ? cardRefs
      : []
  )
    .slice(
      0,
      MAX_CARDS
    )
    .map(
      ref => {
        const facts =
          bySlug.get(
            ref?.slug
          );

        if (!facts) {
          return ref;
        }

        return {
          ...ref,

          facts: {
            version:
              "ProjectCardFactsV1",

            title:
              facts.title,

            price_display:
              facts.price_display,

            district:
              facts.district,

            developer:
              facts.developer
          }
        };
      }
    );
}
