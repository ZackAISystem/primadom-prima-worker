import { supabaseSelect } from "./supabase.js";
import { normalizeSearchContextV1 } from "./search-context.js";

export async function buildContextEnvelope(
  env,
  body,
  message,
  activeMemory = []
) {
  const conversationId =
    body?.conversation_id || null;

  let conversationState = null;
  let recentMessages = [];

  if (conversationId) {
    const [
      stateRows,
      messageRows
    ] = await Promise.all([
      supabaseSelect(
        env,
        "conversations",
        [
          `conversation_id=eq.${conversationId}`,
          "select=language_code,current_intent,dialogue_state,state_version,last_applied_turn_id,last_applied_turn_seq,current_page_id,current_page_type,current_url_path,current_canonical_url_path,current_primary_entity_type,current_primary_entity_slug,current_secondary_entity_type,current_secondary_entity_slug",
          "limit=1"
        ].join("&")
      ),

      supabaseSelect(
        env,
        "messages",
        [
          `conversation_id=eq.${conversationId}`,
          "select=role,content,route,response_type,created_at,page_id,page_type,primary_entity_type,primary_entity_slug,secondary_entity_type,secondary_entity_slug",
          "order=created_at.desc",
          "limit=12"
        ].join("&")
      )
    ]);

    conversationState =
      stateRows?.[0] || null;

    recentMessages =
      messageRows || [];

    recentMessages.reverse();
  }

  return {
    version: "ContextEnvelopeV1",

    conversation_id:
      conversationId,

    visitor_id:
      body?.visitor_id || null,

    session_id:
      body?.session_id || null,

    turn:
      body?.turn ||
      null,

    search:
      normalizeSearchContextV1(
        body?.search_context
      ),

    page: {
      page_id:
        body?.page?.page_id ||
        conversationState?.current_page_id ||
        null,

      page_type:
        body?.page?.page_type ||
        conversationState?.current_page_type ||
        null,

      language_code:
        body?.page?.language_code ||
        conversationState?.language_code ||
        "en",

      url_path:
        body?.page?.url_path ||
        conversationState?.current_url_path ||
        null,

      canonical_url_path:
        body?.page?.canonical_url_path ||
        conversationState?.current_canonical_url_path ||
        null
    },

    entity: {
      primary_type:
        body?.entity?.primary_type ||
        conversationState?.current_primary_entity_type ||
        null,

      primary_slug:
        body?.entity?.primary_slug ||
        conversationState?.current_primary_entity_slug ||
        null,

      secondary_type:
        body?.entity?.secondary_type ||
        conversationState?.current_secondary_entity_type ||
        null,

      secondary_slug:
        body?.entity?.secondary_slug ||
        conversationState?.current_secondary_entity_slug ||
        null
    },

    user: {
      message
    },

    memory: {
      active_facts:
        activeMemory
    },

    conversation: {
      current_intent:
        conversationState
          ?.current_intent ||
        null,

      dialogue_state:
        conversationState
          ?.dialogue_state ||
        null,

      state_version:
        Number(
          conversationState
            ?.state_version ||
          0
        ),

      last_applied_turn_id:
        conversationState
          ?.last_applied_turn_id ||
        null,

      last_applied_turn_seq:
        conversationState
          ?.last_applied_turn_seq ??
        null,

      recent_messages:
        recentMessages
    }
  };
}




/*
  Lightweight Conversation Control hydration.

  Fast deterministic answers must remain fast, but a
  fast answer inside an existing conversation is NOT a
  stateless conversation turn.

  This loads only the single prima.conversations row:
  - no recent messages
  - no Client Memory
  - no Knowledge
  - no Search

  Purpose:
  preserve active/suspended thread and ordering metadata.
*/
export async function hydrateLocalConversationControlState(
  env,
  context = {}
) {
  const conversationId =
    context?.conversation_id ||
    null;

  if (!conversationId) {
    return context;
  }

  const rows =
    await supabaseSelect(
      env,
      "conversations",
      [
        `conversation_id=eq.${conversationId}`,
        "select=language_code,current_intent,dialogue_state,state_version,last_applied_turn_id,last_applied_turn_seq,current_page_id,current_page_type,current_url_path,current_canonical_url_path,current_primary_entity_type,current_primary_entity_slug,current_secondary_entity_type,current_secondary_entity_slug",
        "limit=1"
      ].join("&")
    );

  const row =
    rows?.[0] ||
    null;

  if (!row) {
    return context;
  }

  context.conversation = {
    ...(
      context.conversation ||
      {}
    ),

    current_intent:
      row.current_intent ||
      null,

    dialogue_state:
      row.dialogue_state ||
      null,

    state_version:
      Number(
        row.state_version ||
        0
      ),

    last_applied_turn_id:
      row.last_applied_turn_id ||
      null,

    last_applied_turn_seq:
      row.last_applied_turn_seq ??
      null,

    /*
      Fast path intentionally does not load message
      history. Keep this explicit.
    */
    recent_messages:
      Array.isArray(
        context
          ?.conversation
          ?.recent_messages
      )
        ? context
            .conversation
            .recent_messages
        : []
  };

  /*
    Preserve current browser context first.
    Durable conversation context is only fallback.
  */
  context.page = {
    ...(
      context.page ||
      {}
    ),

    page_id:
      context?.page?.page_id ||
      row.current_page_id ||
      null,

    page_type:
      context?.page?.page_type ||
      row.current_page_type ||
      null,

    language_code:
      context
        ?.page
        ?.language_code ||
      row.language_code ||
      "en",

    url_path:
      context?.page?.url_path ||
      row.current_url_path ||
      null,

    canonical_url_path:
      context
        ?.page
        ?.canonical_url_path ||
      row.current_canonical_url_path ||
      null
  };

  context.entity = {
    ...(
      context.entity ||
      {}
    ),

    primary_type:
      context
        ?.entity
        ?.primary_type ||
      row.current_primary_entity_type ||
      null,

    primary_slug:
      context
        ?.entity
        ?.primary_slug ||
      row.current_primary_entity_slug ||
      null,

    secondary_type:
      context
        ?.entity
        ?.secondary_type ||
      row.current_secondary_entity_type ||
      null,

    secondary_slug:
      context
        ?.entity
        ?.secondary_slug ||
      row.current_secondary_entity_slug ||
      null
  };

  return context;
}


export function buildLocalContextEnvelope(
  body,
  message,
  activeMemory = []
) {
  return {
    version:
      "ContextEnvelopeV1-LOCAL",

    conversation_id:
      body?.conversation_id ||
      null,

    visitor_id:
      body?.visitor_id ||
      null,

    session_id:
      body?.session_id ||
      null,

    turn:
      body?.turn ||
      null,

    search:
      normalizeSearchContextV1(
        body?.search_context
      ),

    page: {
      page_id:
        body?.page?.page_id ||
        null,

      page_type:
        body?.page?.page_type ||
        null,

      language_code:
        body?.page?.language_code ||
        "en",

      url_path:
        body?.page?.url_path ||
        null,

      canonical_url_path:
        body?.page
          ?.canonical_url_path ||
        null
    },

    entity: {
      primary_type:
        body?.entity
          ?.primary_type ||
        null,

      primary_slug:
        body?.entity
          ?.primary_slug ||
        null,

      secondary_type:
        body?.entity
          ?.secondary_type ||
        null,

      secondary_slug:
        body?.entity
          ?.secondary_slug ||
        null
    },

    user: {
      message
    },

    memory: {
      active_facts:
        activeMemory
    },

    conversation: {
      current_intent:
        null,

      dialogue_state:
        null,

      state_version:
        0,

      last_applied_turn_id:
        null,

      last_applied_turn_seq:
        null,

      recent_messages: []
    }
  };
}
