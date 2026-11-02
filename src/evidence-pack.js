const SKIP_KEYS = new Set([
  "agent_inputs",
  "schema_version",
  "content_version_id",
  "href",
  "lat",
  "lng",
  "block_status"
]);


function normalizeText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function shouldSkipKey(key) {
  if (SKIP_KEYS.has(key)) {
    return true;
  }

  return (
    key.endsWith("_ref") ||
    key.endsWith("_status") ||
    key.endsWith("_source")
  );
}


const LOW_VALUE_KEYS = new Set([
  "title",
  "eyebrow",
  "kicker",
  "key",
  "label",
  "chips",
  "actions",
  "section_id",
  "cards_aria",
  "map_point"
]);


function evidencePriority(key = "") {
  const k =
    String(key).toLowerCase();

  if (
    /summary|body_text|body_html|project_logic_text|location_context|scenario_logic|area_logic|note/.test(k)
  ) {
    return 120;
  }

  if (
    k === "text" ||
    k === "body" ||
    k === "answer"
  ) {
    return 115;
  }

  if (k === "value") {
    return 110;
  }

  if (
    /key_facts|items|good_for|less_for|best_for|not_best_for|good_items|bad_items|decision_cards|cards/.test(k)
  ) {
    return 100;
  }

  if (
    /buyer_fit|fit_evidence|facts|logic|address|nearby_landmarks|tags/.test(k)
  ) {
    return 70;
  }

  if (
    LOW_VALUE_KEYS.has(k)
  ) {
    return 10;
  }

  return 50;
}


function pushEvidence(
  out,
  path,
  value,
  maxItems = 8
) {
  if (out.length >= maxItems) {
    return;
  }

  const text =
    normalizeText(value);

  if (
    !text ||
    text === "—" ||
    text.length > 600
  ) {
    return;
  }

  if (
    out.some(
      item =>
        item.value === text
    )
  ) {
    return;
  }

  out.push({
    path:
      path.join("."),
    value:
      text
  });
}


function collectEvidenceItems(
  value,
  path = [],
  out = [],
  depth = 0,
  maxItems = 8
) {
  if (
    value === null ||
    value === undefined ||
    depth > 7 ||
    out.length >= maxItems
  ) {
    return out;
  }


  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    pushEvidence(
      out,
      path,
      value,
      maxItems
    );

    return out;
  }


  if (Array.isArray(value)) {
    for (
      let i = 0;
      i < value.length &&
      out.length < maxItems;
      i += 1
    ) {
      collectEvidenceItems(
        value[i],
        [...path, String(i)],
        out,
        depth + 1,
        maxItems
      );
    }

    return out;
  }


  if (
    typeof value !== "object"
  ) {
    return out;
  }


  // Common fact structure:
  // { label: "Handover", value: "December 2029" }
  if (
    typeof value.label === "string" &&
    (
      typeof value.value === "string" ||
      typeof value.value === "number" ||
      typeof value.value === "boolean"
    )
  ) {
    const rawValue =
      normalizeText(value.value);

    if (
      rawValue &&
      rawValue !== "—"
    ) {
      pushEvidence(
        out,
        path,
        `${normalizeText(value.label)}: ${rawValue}`,
        maxItems
      );
    }

    return out;
  }


  // Common semantic evidence structure.
  if (
    typeof value.item === "string"
  ) {
    pushEvidence(
      out,
      [...path, "item"],
      value.item,
      maxItems
    );

    return out;
  }


  // Decision-card style structure.
  if (
    typeof value.text === "string"
  ) {
    pushEvidence(
      out,
      [...path, "text"],
      value.text,
      maxItems
    );

    return out;
  }


  const entries =
    Object.entries(value)
      .filter(
        ([key]) =>
          !shouldSkipKey(key)
      )
      .sort(
        ([a], [b]) =>
          evidencePriority(b) -
          evidencePriority(a)
      );


  const hasSubstantiveField =
    entries.some(
      ([key]) =>
        evidencePriority(key) >= 70
    );


  for (
    const [key, child]
    of entries
  ) {
    if (
      out.length >= maxItems
    ) {
      break;
    }

    if (
      hasSubstantiveField &&
      LOW_VALUE_KEYS.has(
        String(key).toLowerCase()
      )
    ) {
      continue;
    }

    collectEvidenceItems(
      child,
      [...path, key],
      out,
      depth + 1,
      maxItems
    );
  }

  return out;
}

function collectMissingFields(
  value,
  out = [],
  depth = 0
) {
  if (
    !value ||
    depth > 7
  ) {
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMissingFields(
        item,
        out,
        depth + 1
      );
    }

    return out;
  }

  if (
    typeof value !== "object"
  ) {
    return out;
  }

  if (
    value.value_status === "missing"
  ) {
    const name =
      value.label ||
      value.key ||
      null;

    if (
      name &&
      !out.includes(name)
    ) {
      out.push(name);
    }
  }

  for (
    const child
    of Object.values(value)
  ) {
    collectMissingFields(
      child,
      out,
      depth + 1
    );
  }

  return out;
}


function collectVerificationNotes(
  sources = []
) {
  const notes = [];

  const pattern =
    /\b(verify|verified|confirm|confirmed|check|checked|availability|live inventory|subject to)\b/i;

  for (const source of sources) {
    for (
      const item
      of source.items || []
    ) {
      if (
        pattern.test(item.value) &&
        !notes.includes(item.value)
      ) {
        notes.push(item.value);
      }

      if (notes.length >= 2) {
        return notes;
      }
    }
  }

  return notes;
}


const SOURCE_ITEM_LIMITS = {
  short_answer: 1,
  key_facts: 6,
  buyer_fit: 4,
  project_logic: 1,
  location: 1,

  short_verdict: 1,
  area_facts: 3,
  buyer_fit_logic: 3,
  decision_cards: 2,

  scenario_answer: 1,
  scenario_facts: 4,
  buyer_logic: 3
};


function topicRelevance(
  item,
  topics = []
) {
  const text =
    `${item?.path || ""} ${item?.value || ""}`
      .toLowerCase();

  let score = 0;

  const topicPatterns = {
    family_living:
      /family|families|household|children|school|primary residence|spacious|family-oriented|family friendly/,

    investment:
      /investment|investor|yield|rental|return|appreciation|resale|capital/,

    risk:
      /risk|verify|verification|uncertain|off-plan|handover|availability/,

    financing:
      /mortgage|finance|financing|loan|payment plan|installment/,

    location:
      /location|district|area|address|nearby|beach|waterfront|marina|travel|drive/,

    budget:
      /price|budget|aed|cost|afford|entry price/,

    property_type:
      /apartment|villa|penthouse|townhouse|bedroom|br|unit/,

    developer:
      /developer|track record|portfolio|delivery history|reputation/,

    market:
      /market|transaction|demand|supply|price trend|sales/
  };

  for (const topic of topics || []) {
    const pattern =
      topicPatterns[topic];

    if (
      pattern &&
      pattern.test(text)
    ) {
      score += 100;
    }
  }

  // Useful secondary family/lifestyle context.
  if (
    topics?.includes("family_living") &&
    /waterfront|beachfront|calm|lifestyle|residential/.test(text)
  ) {
    score += 25;
  }

  // Verification language belongs mainly in guardrails,
  // so do not let repeated notes dominate source evidence.
  if (
    /should be checked|should be confirmed|needs verification|verify before|availability should|subject to verified/.test(text)
  ) {
    score -= 40;
  }

  return score;
}


function compactSourceItems(
  block,
  topics = []
) {
  const family =
    block?.block_family || "";

  const limit =
    SOURCE_ITEM_LIMITS[family] || 3;

  const candidates =
    collectEvidenceItems(
      block?.final_block_json || {},
      [],
      [],
      0,
      16
    );

  return candidates
    .map((item, index) => ({
      item,
      index,
      score:
        topicRelevance(
          item,
          topics
        )
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.index - b.index
    )
    .slice(0, limit)
    .map(entry => entry.item);
}


function buildSource({
  block,
  role,
  topics
}) {
  const source = {
    role,

    block_family:
      block?.block_family || null,

    items:
      compactSourceItems(
        block,
        topics
      )
  };

  /*
    Current-page sources already inherit entity
    identity from ContextEnvelope.

    Multi-project Search evidence must carry its
    own identity so facts cannot be mixed between
    candidates during reasoning.
  */
  if (
    block?.entity_type &&
    block?.entity_slug
  ) {
    source.entity = {
      type:
        block.entity_type,

      slug:
        block.entity_slug,

      name:
        block.entity_name ||
        block.entity_slug,

      rank:
        Number(
          block.candidate_rank || 0
        ) || null
    };
  }

  return source;
}


function compactRelation(
  relation
) {
  if (!relation) {
    return null;
  }

  return {
    project_name:
      relation.project_name || null,

    project_slug:
      relation.project_slug || null,

    developer_name:
      relation.developer_name || null,

    developer_slug:
      relation.developer_slug || null,

    district_name:
      relation.district_name || null,

    district_slug:
      relation.district_slug || null
  };
}


function compactBuyerScenario(
  scenario
) {
  if (!scenario) {
    return null;
  }

  return {
    scenario_name:
      scenario.scenario_name || null,

    buyer_goal:
      scenario.buyer_goal || null,

    buyer_persona:
      scenario.buyer_persona || null,

    budget_min_aed:
      scenario.budget_min_aed ?? null,

    budget_max_aed:
      scenario.budget_max_aed ?? null,

    semantic_score:
      scenario.semantic_score ?? null
  };
}


export function buildEvidencePack({
  route,
  message,
  context,
  knowledgePack
}) {
  const currentPage =
    knowledgePack?.page || {};

  const topics =
    knowledgePack
      ?.planner
      ?.topics || [];


  const currentSources =
    (
      knowledgePack?.blocks || []
    )
      .map(block =>
        buildSource({
          block,
          role:
            "current_page",
          topics
        })
      )
      .filter(
        source =>
          source.items.length > 0
      );


  const relatedSources =
    (
      knowledgePack
        ?.related_knowledge
        ?.blocks || []
    )
      .map(block =>
        buildSource({
          block,
          role:
            block.knowledge_role ||
            "related_knowledge",
          topics
        })
      )
      .filter(
        source =>
          source.items.length > 0
      );


  const sources = [
    ...currentSources,
    ...relatedSources
  ];


  const missingFields = [];

  for (
    const block
    of [
      ...(knowledgePack?.blocks || []),
      ...(
        knowledgePack
          ?.related_knowledge
          ?.blocks || []
      )
    ]
  ) {
    collectMissingFields(
      block?.final_block_json,
      missingFields
    );
  }


  const memory =
    (
      context
        ?.memory
        ?.active_facts || []
    )
      .slice(-12)
      .map(item => ({
        key:
          item.fact_key,

        value:
          item.fact_value,

        confidence:
          item.confidence
      }));


  const pack = {
    version:
      "EvidencePackV1-COMPACT",

    route,

    language:
      context
        ?.page
        ?.language_code ||
      "en",

    question:
      message,

    current_page: {
      page_type:
        currentPage.page_type_id ||
        null,

      url_path:
        currentPage.url_path ||
        null
    },

    entity: {
      primary_type:
        context
          ?.entity
          ?.primary_type ||
        null,

      primary_slug:
        context
          ?.entity
          ?.primary_slug ||
        null
    },

    memory,

    planner:
      knowledgePack?.planner
        ? {
            domain:
              knowledgePack
                .planner
                .domain,

            topics
          }
        : null,

    selected_context: {
      relation:
        compactRelation(
          knowledgePack
            ?.relations?.[0]
        ),

      buyer_scenario:
        compactBuyerScenario(
          knowledgePack
            ?.related_knowledge
            ?.selected_buyer_scenario
        )
    },

    sources,

    guardrails: {
      missing_fields:
        missingFields,

      verification_notes:
        collectVerificationNotes(
          sources
        )
    },

    meta: {
      current_blocks:
        currentSources.length,

      related_blocks:
        relatedSources.length,

      source_count:
        sources.length,

      evidence_items:
        sources.reduce(
          (sum, source) =>
            sum +
            source.items.length,
          0
        )
    }
  };


  if (context?.search) {
    pack.search_context =
      context.search;
  }


  pack.meta.approx_chars =
    JSON.stringify(pack).length;

  return pack;
}
