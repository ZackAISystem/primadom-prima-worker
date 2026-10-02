import {
  supabaseInsert,
  supabaseUpdate,
  supabaseSelect
} from "./supabase.js";

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

  for (const fact of facts) {
    await supabaseUpdate(
      env,
      "memory_facts",
      `conversation_id=eq.${conversationId}&fact_key=eq.${encodeURIComponent(fact.fact_key)}&status=eq.active`,
      {
        status: "superseded",
        updated_at: new Date().toISOString()
      }
    );

    const rows = await supabaseInsert(
      env,
      "memory_facts",
      {
        conversation_id: conversationId,
        visitor_id: visitorId,
        fact_key: fact.fact_key,
        fact_value: fact.fact_value,
        confidence: fact.confidence,
        source_message_id: sourceMessageId,
        status: "active"
      },
      "memory_id,fact_key,fact_value,confidence"
    );

    if (rows[0]) {
      saved.push(rows[0]);

      await supabaseInsert(
        env,
        "conversation_events",
        {
          conversation_id: conversationId,
          message_id: sourceMessageId,
          event_name: "memory_fact_captured",
          event_data: {
            fact_key: fact.fact_key
          }
        },
        "event_id"
      );
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
