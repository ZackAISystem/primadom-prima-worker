import { supabaseSelect } from "./supabase.js";

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
          "select=language_code,current_page_id,current_page_type,current_url_path,current_canonical_url_path,current_primary_entity_type,current_primary_entity_slug,current_secondary_entity_type,current_secondary_entity_slug",
          "limit=1"
        ].join("&")
      ),

      supabaseSelect(
        env,
        "messages",
        [
          `conversation_id=eq.${conversationId}`,
          "select=role,content,route,created_at,page_id,page_type,primary_entity_type,primary_entity_slug,secondary_entity_type,secondary_entity_slug",
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
      recent_messages:
        recentMessages
    }
  };
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
      recent_messages: []
    }
  };
}
