import {
  supabaseRpc,
  supabaseSelect
} from "./supabase.js";

import {
  buildKnowledgePlan
} from "./knowledge-planner.js";

import {
  buildAdapterPlan
} from "./knowledge-adapters.js";

import {
  getDistrictBundleFamilies,
  resolveCrossPageKnowledgeFromBundle
} from "./knowledge-cross-page.js";

import {
  extractProjectComparisonTarget
} from "./compare.js";


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
  const startedAt =
    Date.now();

  const page =
    buildContextPage(
      context
    );

  if (!page.page_id) {
    return null;
  }

  const projectSlug =
    page.primary_entity_type ===
      "project"
      ? page.primary_entity_slug
      : null;

  let blocks = [];
  let relations = [];
  let databaseCalls = 1;
  let retrievalMode =
    "exact_fact_fast_path";

  /*
    Project exact facts need not only key_facts.

    Some canonical facts such as location and developer
    live in the verified project relation.

    Reuse the existing Knowledge Bundle RPC so project
    key_facts + relation arrive in ONE database call.
  */
  if (projectSlug) {
    const bundle =
      await supabaseRpc(
        env,
        "resolve_knowledge_bundle_v2",
        {
          p_page_id:
            page.page_id,

          p_project_slug:
            projectSlug,

          p_language_code:
            page.language_code ||
            "en",

          p_current_families: [
            "key_facts"
          ],

          p_district_families: [],

          p_conversation_id:
            null
        }
      );

    blocks =
      Array.isArray(
        bundle?.current_blocks
      )
        ? bundle.current_blocks
        : [];

    if (bundle?.relation) {
      relations = [
        bundle.relation
      ];
    }

    retrievalMode =
      "exact_fact_project_bundle_v2";
  } else {
    blocks =
      await supabaseSelect(
        env,
        "knowledge_blocks_v1",
        [
          "select=block_key,block_index,block_family,final_block_json,content_version_id",
          `page_id=eq.${encodeURIComponent(
            page.page_id
          )}`,
          "block_family=eq.key_facts",
          "limit=1"
        ].join("&")
      );
  }

  return {
    version:
      "UniversalContentResolverV1-FAST",

    resolved:
      blocks.length > 0 ||
      relations.length > 0,

    page,

    blocks,

    relations,

    planner: null,
    adapter: null,

    meta: {
      route,

      page_type:
        page.page_type_id,

      blocks_loaded:
        blocks.length,

      relations_loaded:
        relations.length,

      used_database:
        blocks.length > 0 ||
        relations.length > 0,

      resolver_latency_ms:
        Date.now() -
        startedAt,

      database_calls:
        databaseCalls,

      retrieval_mode:
        retrievalMode
    }
  };
}

function mergeBundleMemory(
  persistedMemory = [],
  currentMemory = []
) {
  const byKey =
    new Map();

  for (
    const fact
    of persistedMemory || []
  ) {
    if (!fact?.fact_key) {
      continue;
    }

    byKey.set(
      fact.fact_key,
      fact
    );
  }

  /*
    Current-turn facts always win over
    older persisted values.
  */
  for (
    const fact
    of currentMemory || []
  ) {
    if (!fact?.fact_key) {
      continue;
    }

    byKey.set(
      fact.fact_key,
      fact
    );
  }

  return [
    ...byKey.values()
  ];
}


async function resolveSelectiveCurrentPage(
  env,
  context,
  route,
  message
) {
  const startedAt =
    Date.now();

  const page =
    buildContextPage(
      context
    );


  if (
    !page.page_id ||
    !page.page_type_id
  ) {
    return null;
  }


  const planner =
    buildKnowledgePlan({
      route,
      message,
      context
    });


  const adapter =
    buildAdapterPlan({
      pageType:
        page.page_type_id,

      needs:
        planner.needs
    });


  const families =
    Array.isArray(
      adapter.block_families
    )
      ? adapter.block_families
      : [];


  if (families.length === 0) {
    return null;
  }


  const districtFamilies =
    getDistrictBundleFamilies(
      planner
    );


  const projectSlug =
    context?.entity?.primary_type ===
      "project"
      ? context?.entity
          ?.primary_slug || null
      : null;


  const bundle =
    await supabaseRpc(
      env,
      "resolve_knowledge_bundle_v2",
      {
        p_page_id:
          page.page_id,

        p_project_slug:
          projectSlug,

        p_language_code:
          page.language_code ||
          "en",

        p_current_families:
          families,

        p_district_families:
          districtFamilies,

        p_conversation_id:
          context
            ?.conversation_id ||
          null
      }
    );


  const persistedMemory =
    Array.isArray(
      bundle?.active_memory
    )
      ? bundle.active_memory
      : [];

  const currentMemory =
    context
      ?.memory
      ?.active_facts ||
    [];

  const mergedMemory =
    mergeBundleMemory(
      persistedMemory,
      currentMemory
    );

  if (!context.memory) {
    context.memory = {
      active_facts: []
    };
  }

  context.memory.active_facts =
    mergedMemory;


  const blocks =
    Array.isArray(
      bundle?.current_blocks
    )
      ? bundle.current_blocks
      : [];


  const crossPage =
    resolveCrossPageKnowledgeFromBundle(
      bundle,
      context,
      planner
    );


  return {
    version:
      "UniversalContentResolverV1-BUNDLE",

    resolved:
      blocks.length > 0,

    page,

    blocks,

    relations:
      crossPage.relations || [],

    related_knowledge:
      crossPage,

    planner: {
      version:
        planner.version,

      route:
        planner.route,

      domain:
        planner.domain,

      topics:
        planner.topics,

      needs:
        planner.needs,

      reasoning_required:
        planner.reasoning_required
    },

    adapter: {
      version:
        adapter.version,

      page_type:
        adapter.page_type,

      block_families:
        adapter.block_families,

      knowledge_page_targets:
        adapter
          .knowledge_page_targets
    },

    meta: {
      route,

      page_type:
        page.page_type_id,

      blocks_loaded:
        blocks.length,

      relations_loaded:
        crossPage.relations
          ?.length || 0,

      related_blocks_loaded:
        crossPage.blocks
          ?.length || 0,

      used_database:
        blocks.length > 0 ||
        crossPage.blocks
          ?.length > 0,

      resolver_latency_ms:
        Date.now() -
        startedAt,

      database_calls: 1,

      active_memory_loaded:
        persistedMemory.length,

      retrieval_mode:
        "selective_bundle_rpc_v2"
    }
  };
}




async function resolveProjectCompareKnowledge(
  env,
  context,
  message
) {
  const startedAt =
    Date.now();

  const currentSlug =
    context
      ?.entity
      ?.primary_type === "project"
      ? context
          ?.entity
          ?.primary_slug || null
      : (
          context
            ?.working_entity
            ?.type === "project"
            ? context
                ?.working_entity
                ?.slug || null
            : null
        );

  if (!currentSlug) {
    return null;
  }

  const workingComparisonTarget =
    typeof context
      ?.working_comparison_target === "string"
      ? context
          .working_comparison_target
          .trim()
      : (
          context
            ?.working_comparison_target
            ?.name ||
          context
            ?.working_comparison_target
            ?.slug ||
          null
        );

  const targetQuery =
    workingComparisonTarget ||
    extractProjectComparisonTarget(
      message,
      currentSlug
    );

  const planner =
    buildKnowledgePlan({
      route: "compare",
      message,
      context
    });

  if (!targetQuery) {
    return {
      version:
        "ProjectCompareResolverV1",

      resolved: false,

      page:
        buildContextPage(
          context
        ),

      blocks: [],
      relations: [],

      related_knowledge: {
        blocks: [],
        relations: [],

        comparison: {
          status:
            "target_missing",

          target_query:
            null,

          candidates: []
        }
      },

      planner: {
        version:
          planner.version,

        route:
          planner.route,

        domain:
          planner.domain,

        topics:
          planner.topics,

        needs:
          planner.needs,

        reasoning_required:
          planner.reasoning_required
      },

      adapter: null,

      meta: {
        route: "compare",

        used_database: false,

        resolver_latency_ms:
          Date.now() -
          startedAt,

        database_calls: 0,

        comparison_status:
          "target_missing",

        retrieval_mode:
          "project_compare_local_guard"
      }
    };
  }


  const families = [
    "short_answer",
    "key_facts",
    "buyer_fit",
    "project_logic",
    "location",
    "decision_cards"
  ];


  const bundle =
    await supabaseRpc(
      env,
      "resolve_project_compare_bundle_v1",
      {
        p_current_project_slug:
          currentSlug,

        p_other_query:
          targetQuery,

        p_language_code:
          context
            ?.page
            ?.language_code ||
          "en",

        p_families:
          families,

        p_conversation_id:
          context
            ?.conversation_id ||
          null
      }
    );


  const persistedMemory =
    Array.isArray(
      bundle?.active_memory
    )
      ? bundle.active_memory
      : [];

  const currentMemory =
    context
      ?.memory
      ?.active_facts ||
    [];

  const mergedMemory =
    mergeBundleMemory(
      persistedMemory,
      currentMemory
    );

  if (!context.memory) {
    context.memory = {
      active_facts: []
    };
  }

  context.memory.active_facts =
    mergedMemory;


  const currentBlocks =
    Array.isArray(
      bundle?.current_blocks
    )
      ? bundle.current_blocks
      : [];

  const otherBlocks =
    Array.isArray(
      bundle?.other_blocks
    )
      ? bundle.other_blocks
      : [];

  const currentRelation =
    bundle?.current_relation ||
    null;

  const otherRelation =
    bundle?.other_relation ||
    null;

  const status =
    bundle?.status ||
    "unknown";


  return {
    version:
      "ProjectCompareResolverV1",

    resolved:
      status === "resolved",

    page:
      bundle?.current_page ||
      buildContextPage(
        context
      ),

    blocks:
      currentBlocks,

    relations: [
      currentRelation,
      otherRelation
    ].filter(Boolean),

    related_knowledge: {
      blocks:
        otherBlocks.map(
          block => ({
            ...block,

            knowledge_role:
              "comparison_target"
          })
        ),

      relations:
        otherRelation
          ? [otherRelation]
          : [],

      comparison: {
        status,

        target_query:
          targetQuery,

        candidates:
          Array.isArray(
            bundle?.candidates
          )
            ? bundle.candidates
            : [],

        current_project:
          bundle?.current_project ||
          null,

        other_project:
          bundle?.other_project ||
          null,

        current_relation:
          currentRelation,

        other_relation:
          otherRelation
      }
    },

    planner: {
      version:
        planner.version,

      route:
        planner.route,

      domain:
        planner.domain,

      topics:
        planner.topics,

      needs:
        planner.needs,

      reasoning_required:
        planner.reasoning_required
    },

    adapter: {
      version:
        "ProjectCompareAdapterV1",

      page_type:
        "project_page",

      block_families:
        families,

      knowledge_page_targets:
        []
    },

    meta: {
      route:
        "compare",

      page_type:
        "project_page",

      blocks_loaded:
        currentBlocks.length +
        otherBlocks.length,

      current_blocks_loaded:
        currentBlocks.length,

      comparison_blocks_loaded:
        otherBlocks.length,

      relations_loaded:
        [
          currentRelation,
          otherRelation
        ].filter(Boolean).length,

      used_database: true,

      resolver_latency_ms:
        Date.now() -
        startedAt,

      database_calls: 1,

      active_memory_loaded:
        persistedMemory.length,

      comparison_status:
        status,

      comparison_target:
        targetQuery,

      retrieval_mode:
        "project_compare_bundle_v1"
    }
  };
}


export async function resolveKnowledge(
  env,
  context,
  route = null,
  message = ""
) {
  // -------------------------------------------------------
  // FAST PATH
  // Exact facts remain deterministic and minimal.
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
  // PROJECT COMPARE PATH
  // One RPC returns both real projects + memory.
  // -------------------------------------------------------

  if (
    route === "compare" &&
    (
      context?.entity
        ?.primary_type === "project" ||
      context?.working_entity
        ?.type === "project"
    )
  ) {
    const comparison =
      await resolveProjectCompareKnowledge(
        env,
        context,
        message
      );

    if (comparison) {
      return comparison;
    }
  }


  // -------------------------------------------------------
  // DAY 2 SELECTIVE PATH
  // Planner → Adapter → selected current-page blocks.
  // -------------------------------------------------------

  if (
    route !== "exact_fact" &&
    context?.page?.page_id
  ) {
    const selective =
      await resolveSelectiveCurrentPage(
        env,
        context,
        route,
        message
      );

    if (selective?.resolved) {
      return selective;
    }
  }


  // -------------------------------------------------------
  // SAFE FALLBACK
  // Keep existing Day 1 resolver until cross-page retrieval
  // is connected.
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

    planner: null,
    adapter: null,

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
        "general_fallback"
    }
  };
}
