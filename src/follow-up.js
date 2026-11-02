function humanizeSlug(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map(
      part =>
        part.charAt(0).toUpperCase() +
        part.slice(1)
    )
    .join(" ");
}


function recentMessages(context) {
  return Array.isArray(
    context
      ?.conversation
      ?.recent_messages
  )
    ? context.conversation.recent_messages
    : [];
}


function extractCompareCandidates(content) {
  const text =
    String(content || "");

  const match =
    text.match(
      /I found\s+\d+\s+projects?\s+matching\s+"[^"]+":\s*(.+?)\.\s*Which one/i
    );

  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(/\s+and\s+/i)
    .map(item => item.trim())
    .filter(Boolean);
}


function ordinalIndex(message) {
  const q =
    String(message || "")
      .toLowerCase();

  if (
    /\b(first|1st)\b/.test(q)
  ) {
    return 0;
  }

  if (
    /\b(second|2nd)\b/.test(q)
  ) {
    return 1;
  }

  if (
    /\b(third|3rd)\b/.test(q)
  ) {
    return 2;
  }

  return null;
}



/*
  E1_CANONICAL_CONVERSATION_ENTITY_V1

  ConversationState is authoritative for the
  currently selected conversational entity.

  Ordinal references retain their existing
  SearchContext resolution path.

  No entity is fabricated or inferred from
  an unverified conversational phrase.
*/
function e1CanonicalConversationEntity(context) {
  const candidates = [
    context?.conversation?.dialogue_state
      ?.continuity_references?.current_entity,

    context?.conversation?.state
      ?.continuity_references?.current_entity,

    context?.conversation_state
      ?.continuity_references?.current_entity,

    context?.state
      ?.continuity_references?.current_entity
  ];

  for (const candidate of candidates) {
    const type = String(
      candidate?.type || ""
    );

    const slug = String(
      candidate?.slug || ""
    );

    if (
      !["project", "developer", "district"].includes(type) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ) {
      continue;
    }

    return {
      type,
      slug,
      name:
        String(candidate?.name || "").trim() ||
        humanizeSlug(slug),
      source:
        "canonical_conversation_state"
    };
  }

  return null;
}

function latestStoredEntity(context) {
  const canonical =
    e1CanonicalConversationEntity(context);

  if (canonical) {
    return canonical;
  }


  const messages =
    recentMessages(context);

  for (
    let i = messages.length - 1;
    i >= 0;
    i--
  ) {
    const item = messages[i];

    if (
      item?.primary_entity_type &&
      item?.primary_entity_slug
    ) {
      return {
        type:
          item.primary_entity_type,

        slug:
          item.primary_entity_slug,

        name:
          humanizeSlug(
            item.primary_entity_slug
          ),

        source:
          "recent_message"
      };
    }
  }

  return null;
}


function currentContextEntity(context) {
  const canonical =
    e1CanonicalConversationEntity(context);

  if (canonical) {
    return canonical;
  }


  const type =
    context
      ?.entity
      ?.primary_type;

  const slug =
    context
      ?.entity
      ?.primary_slug;

  if (!type || !slug) {
    return null;
  }

  return {
    type,
    slug,
    name:
      humanizeSlug(slug),
    source:
      "current_context"
  };
}


export function resolveFollowUpReference({
  message,
  context
}) {
  const q =
    String(message || "")
      .trim()
      .toLowerCase();

  const messages =
    recentMessages(context);

  const ordinal =
    ordinalIndex(q);

  /*
    "the second one" after an ambiguity response.
    We intentionally resolve only from a recent
    deterministic compare clarification.
  */
  if (ordinal !== null) {
    const search =
      context?.search;

    const searchOffset =
      Number.isInteger(
        search?.current_batch_offset
      )
        ? search.current_batch_offset
        : 0;

    const searchResult =
      Array.isArray(
        search?.results
      )
        ? search.results[
            searchOffset +
            ordinal
          ] || null
        : null;

    if (
      ["project", "developer", "district"].includes(
        searchResult?.entity_type || search?.entity_type
      ) &&
      searchResult?.slug
    ) {
      return {
        resolved: true,

        type:
          searchResult.entity_type ||
          search.entity_type,

        slug:
          searchResult.slug,

        name:
          searchResult.title ||
          humanizeSlug(
            searchResult.slug
          ),

        source:
          "search_context_ordinal"
      };
    }

    for (
      let i = messages.length - 1;
      i >= 0;
      i--
    ) {
      const item =
        messages[i];

      if (
        item?.role !== "assistant" ||
        item?.route !== "compare"
      ) {
        continue;
      }

      const candidates =
        extractCompareCandidates(
          item?.content
        );

      if (candidates[ordinal]) {
        return {
          resolved: true,
          type: "project",
          slug: null,
          name:
            candidates[ordinal],
          source:
            "compare_ambiguity"
        };
      }
    }

    return {
      resolved: false,
      reason:
        "ordinal_without_candidates"
    };
  }

  /*
    "this one" should prefer the entity/page the
    user is currently looking at.
  */
  if (
    /\b(this one|this project|this area|this district|this developer)\b/i
      .test(q)
  ) {
    const current =
      currentContextEntity(
        context
      );

    if (current) {
      return {
        resolved: true,
        ...current
      };
    }
  }

  /*
    "that one", "it", "its", etc. prefer recent
    conversation entity, with current context as fallback.
  */
  if (
    /\b(that one|that project|that area|that district|that developer|it|its|this|that)\b/i
      .test(q)
  ) {
    const recent =
      latestStoredEntity(
        context
      );

    if (recent) {
      return {
        resolved: true,
        ...recent
      };
    }

    const current =
      currentContextEntity(
        context
      );

    if (current) {
      return {
        resolved: true,
        ...current
      };
    }
  }

  return {
    resolved: false,
    reason:
      "reference_not_resolved"
  };
}
