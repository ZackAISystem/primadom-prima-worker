import {
  supabaseRpc,
  supabaseSelect
} from "./supabase.js";


function buildContextPage(context) {
  return {
    page_id:
      context?.page?.page_id || null,

    page_type_id:
      context?.page?.page_type || null,

    language_code:
      context?.page?.language_code || "en",

    url_path:
      context?.page?.url_path || null,

    canonical_url_path:
      context?.page?.canonical_url_path || null,

    primary_entity_type:
      context?.entity?.primary_type || null,

    primary_entity_slug:
      context?.entity?.primary_slug || null
  };
}


async function resolveExactFact(
  env,
  context,
  route
) {
  const startedAt = Date.now();

  const page =
    buildContextPage(context);

  if (!page.page_id) {
    return null;
  }

  const blocks = await supabaseSelect(
    env,
    "knowledge_blocks_v1",
    [
      "select=block_key,block_index,block_family,final_block_json,content_version_id",
      `page_id=eq.${encodeURIComponent(page.page_id)}`,
      "block_family=eq.key_facts",
      "limit=1"
    ].join("&")
  );

  return {
    version:
      "UniversalContentResolverV1-FAST",

    resolved:
      blocks.length > 0,

    page,

    blocks,

    relations: [],

    meta: {
      route,

      page_type:
        page.page_type_id,

      blocks_loaded:
        blocks.length,

      relations_loaded: 0,

      used_database:
        blocks.length > 0,

      resolver_latency_ms:
        Date.now() - startedAt,

      database_calls: 1,

      retrieval_mode:
        "exact_fact_fast_path"
    }
  };
}


export async function resolveKnowledge(
  env,
  context,
  route = null
) {
  // -------------------------------------------------------
  // FAST PATH
  // Exact facts must never load the full page knowledge.
  // -------------------------------------------------------

  if (
    route === "exact_fact" &&
    context?.page?.page_id
  ) {
    const fast =
      await resolveExactFact(
        env,
        context,
        route
      );

    if (fast?.resolved) {
      return fast;
    }
  }


  // -------------------------------------------------------
  // GENERAL PATH
  // Day 2 Knowledge Planner will make this selective too.
  // -------------------------------------------------------

  const startedAt = Date.now();

  const result = await supabaseRpc(
    env,
    "resolve_page_knowledge_v1",
    {
      p_page_id:
        context?.page?.page_id || null,

      p_url_path:
        context?.page?.url_path || null,

      p_language_code:
        context?.page?.language_code || "en",

      p_primary_entity_type:
        context?.entity?.primary_type || null,

      p_primary_entity_slug:
        context?.entity?.primary_slug || null
    }
  );

  const resolved =
    result?.resolved === true;

  const page =
    result?.page || null;

  const blocks =
    Array.isArray(result?.blocks)
      ? result.blocks
      : [];

  const relations =
    Array.isArray(result?.relations)
      ? result.relations
      : [];

  return {
    version:
      "UniversalContentResolverV1-RPC",

    resolved,

    page,

    blocks,

    relations,

    meta: {
      route,

      page_type:
        page?.page_type_id || null,

      blocks_loaded:
        blocks.length,

      relations_loaded:
        relations.length,

      used_database:
        resolved,

      resolver_latency_ms:
        Date.now() - startedAt,

      database_calls: 1,

      retrieval_mode:
        "general"
    }
  };
}
