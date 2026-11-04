import {
  supabaseRpc
} from "./supabase.js";

const MAX_CANDIDATES = 10;

const KNOWLEDGE_FAMILIES = [
  "key_facts",
  "buyer_fit",
  "project_logic"
];


function validSearchSlugs(
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
    search?.state !== "results" ||
    !Array.isArray(
      search?.results
    )
  ) {
    return [];
  }

  const offset =
    Number.isInteger(
      search?.current_batch_offset
    )
      ? search.current_batch_offset
      : 0;

  return search.results
    .slice(
      offset,
      offset + MAX_CANDIDATES
    )
    .filter(
      item =>
        item?.entity_type ===
          "project" &&
        item?.slug
    )
    .map(
      item =>
        String(
          item.slug
        ).trim()
    )
    .filter(Boolean);
}


export function shouldResolveSearchCandidateKnowledge({
  route = null,
  context = null
} = {}) {
  /*
    Simple property_search does not need
    Knowledge/OpenAI just to show cards.

    Search-backed recommendation does.
  */
  return (
    route === "recommendation" &&
    validSearchSlugs(
      context
    ).length > 0
  );
}


function normalizeBlock(
  block,
  allowedSlugs
) {
  if (
    !block ||
    typeof block !== "object" ||
    Array.isArray(block)
  ) {
    return null;
  }

  const slug =
    String(
      block.entity_slug || ""
    ).trim();

  if (
    !slug ||
    !allowedSlugs.has(slug) ||
    block.entity_type !== "project"
  ) {
    return null;
  }

  const finalJson =
    block.final_block_json;

  if (
    !finalJson ||
    typeof finalJson !== "object" ||
    Array.isArray(finalJson)
  ) {
    return null;
  }

  return {
    entity_type:
      "project",

    entity_slug:
      slug,

    entity_name:
      String(
        block.entity_name ||
        slug
      ).trim(),

    candidate_rank:
      Number(
        block.candidate_rank || 0
      ),

    page_id:
      String(
        block.page_id || ""
      ).trim(),

    block_key:
      String(
        block.block_key || ""
      ).trim(),

    block_index:
      Number(
        block.block_index || 0
      ),

    block_family:
      String(
        block.block_family || ""
      ).trim(),

    final_block_json:
      finalJson,

    content_version_id:
      block.content_version_id ||
      null,

    knowledge_role:
      "search_candidate"
  };
}


export function normalizeSearchKnowledgeResult(
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

  const allowedSlugs =
    new Set(
      requestedSlugs
        .slice(
          0,
          MAX_CANDIDATES
        )
        .map(
          slug =>
            String(
              slug || ""
            ).trim()
        )
        .filter(Boolean)
    );

  const blocks =
    (
      Array.isArray(raw.blocks)
        ? raw.blocks
        : []
    )
      .map(
        block =>
          normalizeBlock(
            block,
            allowedSlugs
          )
      )
      .filter(Boolean);

  const candidateSlugs =
    Array.from(
      new Set(
        blocks.map(
          block =>
            block.entity_slug
        )
      )
    );

  return {
    version:
      "SearchKnowledgeBundleV1",

    resolved:
      Boolean(
        raw.resolved
      ) &&
      candidateSlugs.length > 0,

    candidate_count:
      candidateSlugs.length,

    candidate_slugs:
      candidateSlugs,

    blocks
  };
}


export async function resolveSearchCandidateKnowledge(
  env,
  context
) {
  const slugs =
    validSearchSlugs(
      context
    );

  if (!slugs.length) {
    return null;
  }

  let raw;
  try {
    raw = await supabaseRpc(
      env,
      "resolve_search_project_knowledge_v1",
      {
        p_project_slugs:
          slugs,
        p_language_code: "en",
        p_families: KNOWLEDGE_FAMILIES
      }
    );
  } catch (error) {
    const detail = String(error?.message || error);
    // This is optional enrichment: a timed-out knowledge lookup must
    // not break verified project search results or their pagination.
    // Preserve all other errors for diagnosis rather than hiding them.
    if (!detail.startsWith("supabase_rpc_failed:500:") ||
        !detail.includes('"code":"57014"')) {
      throw error;
    }
    console.warn("recommendation_knowledge_rpc_timeout", {
      rpc: "resolve_search_project_knowledge_v1",
      candidate_count: slugs.length
    });
    return null;
  }

  return normalizeSearchKnowledgeResult(
    raw,
    slugs
  );
}


function unique(
  values
) {
  return Array.from(
    new Set(
      values.filter(Boolean)
    )
  );
}


export function mergeSearchCandidateKnowledge(
  knowledgePack,
  searchKnowledge
) {
  if (
    !searchKnowledge?.resolved ||
    !Array.isArray(
      searchKnowledge?.blocks
    ) ||
    !searchKnowledge.blocks.length
  ) {
    return knowledgePack;
  }

  const base =
    knowledgePack || {};

  const related =
    base.related_knowledge &&
    typeof base.related_knowledge ===
      "object"
      ? base.related_knowledge
      : {};

  const existingBlocks =
    Array.isArray(
      related.blocks
    )
      ? related.blocks
      : [];

  const existingPlanner =
    base.planner &&
    typeof base.planner ===
      "object"
      ? base.planner
      : {};

  const existingMeta =
    base.meta &&
    typeof base.meta ===
      "object"
      ? base.meta
      : {};

  return {
    ...base,

    resolved:
      true,

    related_knowledge: {
      ...related,

      blocks: [
        ...existingBlocks,
        ...searchKnowledge.blocks
      ],

      search_candidates: {
        version:
          "SearchKnowledgeBundleV1",

        slugs:
          searchKnowledge
            .candidate_slugs
      }
    },

    planner: {
      ...existingPlanner,

      version:
        existingPlanner.version ||
        "SearchRecommendationPlanV1",

      route:
        "recommendation",

      domain:
        existingPlanner.domain ||
        "project",

      topics:
        unique([
          ...(
            Array.isArray(
              existingPlanner.topics
            )
              ? existingPlanner.topics
              : []
          ),
          "buyer_fit",
          "project_logic"
        ]),

      needs:
        unique([
          ...(
            Array.isArray(
              existingPlanner.needs
            )
              ? existingPlanner.needs
              : []
          ),
          "search_candidates"
        ]),

      reasoning_required:
        true
    },

    meta: {
      ...existingMeta,

      used_database:
        true,

      search_candidate_count:
        searchKnowledge
          .candidate_count,

      search_blocks_loaded:
        searchKnowledge
          .blocks
          .length
    }
  };
}
