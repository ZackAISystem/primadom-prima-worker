import { routeIntent } from "./router.js";
import { extractMemoryFacts } from "./memory.js";
import { buildContextEnvelope } from "./context.js";
import { resolveKnowledge } from "./knowledge.js";
import { buildStructuredAnswer } from "./structured-answer.js";
import {
  persistMemoryFacts,
  loadActiveMemory
} from "./memory-store.js";
import {
  supabaseInsert,
  supabaseUpdate
} from "./supabase.js";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...cors
    }
  });

function buildResponse({
  conversationId,
  route,
  answer
}) {
  return {
    version: "ResponseContractV1",
    conversation_id: conversationId,
    route,
    response_type: "answer",
    answer,
    cards: [],
    follow_up: null,
    lead_action: null,
    meta: {
      language: "en",
      used_openai: false,
      used_database: false,
      used_search: false
    }
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    // =====================================================
    // HEALTH
    // =====================================================

    if (
      request.method === "GET" &&
      url.pathname === "/api/prima/health"
    ) {
      return json({
        ok: true,
        service: "primadom-prima-worker",
        version: "0.3.0",
        phase: "day-1-memory",
        language: "en",
        supabase_configured: Boolean(
          env.SUPABASE_REST_URL &&
          env.SUPABASE_SECRET_KEY
        ),
        timestamp: new Date().toISOString()
      });
    }

    // =====================================================
    // START CONVERSATION
    // =====================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/prima/conversation/start"
    ) {
      let body = {};

      try {
        body = await request.json();
      } catch {
        // request body is optional
      }

      try {
        const rows = await supabaseInsert(
          env,
          "conversations",
          {
            visitor_id: body.visitor_id || null,
            session_id: body.session_id || null,

            language_code:
              body?.page?.language_code || "en",

            started_page_id:
              body?.page?.page_id || null,

            current_page_id:
              body?.page?.page_id || null,

            current_page_type:
              body?.page?.page_type || null,

            current_url_path:
              body?.page?.url_path || null,

            current_canonical_url_path:
              body?.page?.canonical_url_path || null,

            current_primary_entity_type:
              body?.entity?.primary_type || null,

            current_primary_entity_slug:
              body?.entity?.primary_slug || null,

            current_secondary_entity_type:
              body?.entity?.secondary_type || null,

            current_secondary_entity_slug:
              body?.entity?.secondary_slug || null,

            metadata: {
              source: "prima_dialog",
              contract: "ContextEnvelopeV1"
            }
          },
          "conversation_id,status,language_code,started_at"
        );

        return json({
          ok: true,
          version: "ConversationStartV1",
          conversation: rows[0]
        });
      } catch (error) {
        console.error(error);

        return json(
          {
            ok: false,
            error: "conversation_start_failed"
          },
          500
        );
      }
    }

    // =====================================================
    // MESSAGE
    // =====================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/prima/message"
    ) {
      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            ok: false,
            error: "invalid_json"
          },
          400
        );
      }

      const conversationId =
        body?.conversation_id || null;

      const message =
        String(body?.user?.message || "").trim();

      if (!conversationId) {
        return json(
          {
            ok: false,
            error: "conversation_id_required"
          },
          400
        );
      }

      if (!message) {
        return json(
          {
            ok: false,
            error: "message_required"
          },
          400
        );
      }

      try {
        const memoryBeforeTurn =
          await loadActiveMemory(
            env,
            conversationId
          );

        const routingContext =
          await buildContextEnvelope(
            env,
            body,
            message,
            memoryBeforeTurn
          );

        const route =
          routeIntent(
            message,
            routingContext
          );
        const userRows = await supabaseInsert(
          env,
          "messages",
          {
            conversation_id: conversationId,
            role: "user",
            content: message,
            route,

            page_id:
              body?.page?.page_id || null,

            page_type:
              body?.page?.page_type || null,

            primary_entity_type:
              body?.entity?.primary_type || null,

            primary_entity_slug:
              body?.entity?.primary_slug || null,

            secondary_entity_type:
              body?.entity?.secondary_type || null,

            secondary_entity_slug:
              body?.entity?.secondary_slug || null,

            metadata: {
              contract: "ContextEnvelopeV1"
            }
          },
          "message_id,created_at"
        );

        const extractedFacts =
          extractMemoryFacts(message);

        const savedMemory =
          await persistMemoryFacts(env, {
            conversationId,
            visitorId: body?.visitor_id || null,
            sourceMessageId:
              userRows?.[0]?.message_id || null,
            facts: extractedFacts
          });

        const activeMemory =
          await loadActiveMemory(
            env,
            conversationId
          );

        const contextEnvelope =
          await buildContextEnvelope(
            env,
            body,
            message,
            activeMemory
          );

        const knowledgePack =
          await resolveKnowledge(
            env,
            contextEnvelope,
            route
          );

        const structuredAnswer =
  buildStructuredAnswer({
    message,
    route,
    knowledgePack
  });

const answer =
  structuredAnswer?.answer ||
  `Prima routing preview: "${message}" → ${route}`;

        const response = buildResponse({
          conversationId,
          route,
          answer
        });

        response.meta.used_database =
          knowledgePack.meta.used_database;

        const assistantRows = await supabaseInsert(
          env,
          "messages",
          {
            conversation_id: conversationId,
            role: "assistant",
            content: answer,
            route,
            response_type: "answer",

            page_id:
              body?.page?.page_id || null,

            page_type:
              body?.page?.page_type || null,

            primary_entity_type:
              body?.entity?.primary_type || null,

            primary_entity_slug:
              body?.entity?.primary_slug || null,

            secondary_entity_type:
              body?.entity?.secondary_type || null,

            secondary_entity_slug:
              body?.entity?.secondary_slug || null,

            used_openai: false,
            used_database:
              knowledgePack.meta.used_database,
            used_search: false,

            metadata: {
              contract: "ResponseContractV1"
            }
          },
          "message_id,created_at"
        );

        await supabaseInsert(
          env,
          "conversation_events",
          {
            conversation_id: conversationId,
            message_id:
              userRows?.[0]?.message_id || null,

            event_name: "message_routed",

            event_data: {
              route,
              language:
                body?.page?.language_code || "en"
            }
          },
          "event_id"
        );

        const conversationPatch = {
          current_intent: route,
          last_message_at:
            new Date().toISOString()
        };

        if (body?.page?.page_id) {
          conversationPatch.current_page_id =
            body.page.page_id;
        }

        if (body?.page?.page_type) {
          conversationPatch.current_page_type =
            body.page.page_type;
        }

        if (body?.page?.url_path) {
          conversationPatch.current_url_path =
            body.page.url_path;
        }

        if (body?.page?.canonical_url_path) {
          conversationPatch.current_canonical_url_path =
            body.page.canonical_url_path;
        }

        if (body?.page?.language_code) {
          conversationPatch.language_code =
            body.page.language_code;
        }

        if (body?.entity?.primary_type) {
          conversationPatch.current_primary_entity_type =
            body.entity.primary_type;
        }

        if (body?.entity?.primary_slug) {
          conversationPatch.current_primary_entity_slug =
            body.entity.primary_slug;
        }

        if (body?.entity?.secondary_type) {
          conversationPatch.current_secondary_entity_type =
            body.entity.secondary_type;
        }

        if (body?.entity?.secondary_slug) {
          conversationPatch.current_secondary_entity_slug =
            body.entity.secondary_slug;
        }

        await supabaseUpdate(
          env,
          "conversations",
          `conversation_id=eq.${conversationId}`,
          conversationPatch
        );

        return json({
          ...response,
          debug: {
            persisted: true,
            user_message_id:
              userRows?.[0]?.message_id || null,
            assistant_message_id:
              assistantRows?.[0]?.message_id || null,
            memory_facts_captured:
              savedMemory.length,
            active_memory:
              activeMemory,
            context_envelope:
              contextEnvelope,
            knowledge_pack:
              knowledgePack
          }
        });
      } catch (error) {
        console.error(error);

        return json(
          {
            ok: false,
            error: "message_persistence_failed",
            detail:
              error?.message ||
              String(error)
          },
          500
        );
      }
    }

    return json(
      {
        ok: false,
        error: "not_found"
      },
      404
    );
  }
};
