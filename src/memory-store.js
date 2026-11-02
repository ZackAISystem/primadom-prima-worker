import {
  supabaseInsertIdempotentEvent,
  supabaseSelect,
  supabaseRpc
} from "./supabase.js";

import {
  normalizeMemoryFacts
} from "./memory.js";


const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


function normalizeUuid(
  value
) {
  if (
    typeof value === "string" &&
    UUID_PATTERN.test(value)
  ) {
    return value;
  }

  return null;
}


export async function persistMemoryFacts(
  env,
  {
    conversationId,
    visitorId = null,
    sourceMessageId = null,
    facts = []
  }
) {
  const saved = [];

  for (
    const fact of
    normalizeMemoryFacts(facts)
  ) {
    const result =
      await supabaseRpc(
        env,
        "persist_memory_fact_v2",
        {
          p_conversation_id:
            conversationId,

          p_visitor_id:
            normalizeUuid(
              visitorId
            ),

          p_source_message_id:
            normalizeUuid(
              sourceMessageId
            ),

          p_fact_key:
            fact.fact_key,

          p_fact_value:
            fact.fact_value,

          p_confidence:
            Number(
              fact.confidence ?? 0
            )
        }
      );

    if (result?.memory_id) {
      saved.push(
        result
      );

      try {
        await supabaseInsertIdempotentEvent(
          env,
          "conversation_events",
          {
            conversation_id:
              conversationId,

            message_id:
              normalizeUuid(
                sourceMessageId
              ),

            event_name:
              "memory_fact_captured",

            event_data: {
              fact_key:
                fact.fact_key,

              action:
                result.action ||
                null
            }
          },
          "event_id"
        );
      } catch (error) {
        console.warn(
          "memory_event_write_failed",
          error?.message ||
          String(error)
        );
      }
    }
  }

  return saved;
}


export async function loadActiveMemory(
  env,
  conversationId
) {
  return supabaseSelect(
    env,
    "memory_facts",
    [
      `conversation_id=eq.${conversationId}`,
      "status=eq.active",
      "select=fact_key,fact_value,confidence,updated_at",
      "order=updated_at.asc"
    ].join("&")
  );
}
