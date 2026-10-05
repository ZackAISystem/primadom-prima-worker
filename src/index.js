import { routeIntent } from "./router.js";
import { extractProjectComparisonTarget } from "./compare.js";
import { extractMemoryFacts } from "./memory.js";
import {
  buildContextEnvelope,
  buildLocalContextEnvelope
} from "./context.js";
import { resolveKnowledge } from "./knowledge.js";
import { buildEvidencePack } from "./evidence-pack.js";
import {
  shouldUseOpenAI,
  generatePrimaAnswer
} from "./openai-reasoning.js";
import { buildStructuredAnswer } from "./structured-answer.js";
import { buildGroundedFallback } from "./grounded-fallback.js";
import { buildLocalRouteAnswer } from "./local-responses.js";
import {
  getToolIds,
  canUseTool
} from "./tool-registry.js";
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

function emptyKnowledgePack(route) {
  return {
    version: "NoKnowledgeRequiredV1",
    resolved: false,
    page: null,
    blocks: [],
    relations: [],
    meta: {
      route,
      page_type: null,
      blocks_loaded: 0,
      relations_loaded: 0,
      used_database: false,
      resolver_latency_ms: 0,
      database_calls: 0,
      retrieval_mode: "not_required"
    }
  };
}



function isGlobalNoKnowledgeGuard(
  message
) {
  const q =
    String(message || "")
      .trim()
      .toLowerCase();

  const paymentPlan =
    /\b(payment plan|payment schedule|installment plan|instalment plan|installments|instalments)\b/i
      .test(q);

  const liveAvailability =
    /\b(availability|available right now|available now|units? available|live inventory|inventory now)\b/i
      .test(q);

  return (
    paymentPlan ||
    liveAvailability
  );
}


function canUseStatelessFastPath({
  body,
  message,
  route
}) {
  if (
    route === "persona_question" ||
    route === "market_question" ||
    route === "unsupported" ||
    isGlobalNoKnowledgeGuard(message)
  ) {
    return true;
  }

  const hasResolvedPage =
    Boolean(
      body?.page?.page_id &&
      body?.page?.page_type
    );

  const hasResolvedEntity =
    Boolean(
      body?.entity?.primary_type &&
      body?.entity?.primary_slug
    );

  if (
    !hasResolvedPage ||
    !hasResolvedEntity
  ) {
    return false;
  }

  /*
    Explicit project comparison does not need
    synchronous conversation/history reads.

    The Compare Bundle RPC already returns:
    - both projects
    - selected knowledge
    - active client memory

    Referential targets remain on the full
    conversation path.
  */
  if (
    route === "compare" &&
    body?.entity?.primary_type === "project"
  ) {
    const target =
      extractProjectComparisonTarget(
        message,
        body?.entity?.primary_slug || ""
      );

    const needsHistory =
      /\b(this one|that one|the first one|the second one|the third one|first one|second one|third one|previous one|earlier one|those|these)\b/i
        .test(
          target || ""
        );

    return Boolean(
      target &&
      !needsHistory
    );
  }

  if (route === "exact_fact") {
    return true;
  }

  if (route !== "page_question") {
    return false;
  }

  /*
    These phrases can depend on earlier
    conversation state/preferences.
    Keep them on the full-context path.
  */
  const needsConversationHistory =
    /\b(the other|other one|another one|previous|earlier|same one|as before|for us|for me|my preferences|our preferences|those options|these options)\b/i
      .test(message);

  return !needsConversationHistory;
}


function mergeCurrentTurnMemory(
  existingMemory = [],
  currentFacts = []
) {
  const byKey = new Map();

  for (const fact of existingMemory || []) {
    if (!fact?.fact_key) {
      continue;
    }

    byKey.set(
      fact.fact_key,
      fact
    );
  }

  for (const fact of currentFacts || []) {
    if (!fact?.fact_key) {
      continue;
    }

    byKey.set(
      fact.fact_key,
      {
        fact_key:
          fact.fact_key,

        fact_value:
          fact.fact_value,

        confidence:
          fact.confidence,

        updated_at:
          new Date().toISOString(),

        source:
          "current_turn"
      }
    );
  }

  return [...byKey.values()];
}


function buildConversationPatch(
  body,
  route
) {
  const patch = {
    current_intent: route,
    last_message_at:
      new Date().toISOString()
  };

  if (body?.page?.page_id) {
    patch.current_page_id =
      body.page.page_id;
  }

  if (body?.page?.page_type) {
    patch.current_page_type =
      body.page.page_type;
  }

  if (body?.page?.url_path) {
    patch.current_url_path =
      body.page.url_path;
  }

  if (body?.page?.canonical_url_path) {
    patch.current_canonical_url_path =
      body.page.canonical_url_path;
  }

  if (body?.page?.language_code) {
    patch.language_code =
      body.page.language_code;
  }

  if (body?.entity?.primary_type) {
    patch.current_primary_entity_type =
      body.entity.primary_type;
  }

  if (body?.entity?.primary_slug) {
    patch.current_primary_entity_slug =
      body.entity.primary_slug;
  }

  if (body?.entity?.secondary_type) {
    patch.current_secondary_entity_type =
      body.entity.secondary_type;
  }

  if (body?.entity?.secondary_slug) {
    patch.current_secondary_entity_slug =
      body.entity.secondary_slug;
  }

  return patch;
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const debugEnabled =
      url.searchParams.get("debug") === "1";

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
    // LEAD CONTEXT
    // =====================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/prima/lead-context"
    ) {
      let body = {};

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

      if (!conversationId) {
        return json(
          {
            ok: false,
            error: "conversation_id_required"
          },
          400
        );
      }

      try {
        const activeMemory =
          await loadActiveMemory(
            env,
            conversationId
          );

        const contextEnvelope =
          await buildContextEnvelope(
            env,
            body,
            "",
            activeMemory
          );

        return json({
          ok: true,
          version: "LeadContextV1",
          conversation_id: conversationId,

          context: {
            language:
              contextEnvelope?.language || "en",

            page:
              contextEnvelope?.page || null,

            entity:
              contextEnvelope?.entity || null,

            user:
              contextEnvelope?.user || null,

            memory:
              activeMemory
          }
        });
      } catch (error) {
        console.error(error);

        return json(
          {
            ok: false,
            error: "lead_context_failed",
            ...(debugEnabled
              ? {
                  detail:
                    error?.message ||
                    String(error)
                }
              : {})
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
        const extractedFacts =
          extractMemoryFacts(message);

        let activeMemory =
          mergeCurrentTurnMemory(
            [],
            extractedFacts
          );

        let contextEnvelope =
          buildLocalContextEnvelope(
            body,
            message,
            activeMemory
          );

        let route =
          routeIntent(
            message,
            contextEnvelope
          );

        const statelessFastPath =
          canUseStatelessFastPath({
            body,
            message,
            route
          });


        if (!statelessFastPath) {
          const [
            memoryBeforeTurn,
            fullContextEnvelope
          ] = await Promise.all([
            loadActiveMemory(
              env,
              conversationId
            ),

            buildContextEnvelope(
              env,
              body,
              message,
              []
            )
          ]);

          activeMemory =
            mergeCurrentTurnMemory(
              memoryBeforeTurn,
              extractedFacts
            );

          fullContextEnvelope
            .memory
            .active_facts =
              activeMemory;

          contextEnvelope =
            fullContextEnvelope;

          route =
            routeIntent(
              message,
              contextEnvelope
            );
        }


        const allowedTools =
          getToolIds(route);

        const needsKnowledge =
          !isGlobalNoKnowledgeGuard(
            message
          ) &&
          (
            canUseTool(
              route,
              "structured_lookup"
            ) ||
            canUseTool(
              route,
              "knowledge_retrieve"
            )
          );

        const knowledgePack =
          needsKnowledge
            ? await resolveKnowledge(
                env,
                contextEnvelope,
                route,
                message
              )
            : emptyKnowledgePack(route);

        activeMemory =
          contextEnvelope
            ?.memory
            ?.active_facts ||
          activeMemory;

        const evidencePack =
          buildEvidencePack({
            route,
            message,
            context: contextEnvelope,
            knowledgePack
          });

        const localAnswer =
          buildLocalRouteAnswer({
            route,
            message,
            knowledgePack,
            context:
              contextEnvelope
          });

        const structuredAnswer =
          canUseTool(
            route,
            "structured_lookup"
          )
            ? buildStructuredAnswer({
                message,
                route,
                knowledgePack
              })
            : null;

        const useOpenAI =
          !localAnswer &&
          !structuredAnswer &&
          shouldUseOpenAI({
            route,
            evidencePack,
            knowledgePack
          });

        const openAIResult =
          useOpenAI
            ? await generatePrimaAnswer({
                env,
                route,
                evidencePack,
                deadlineMs: 600
              })
            : null;

        const fallbackAnswer =
          !localAnswer &&
          !structuredAnswer &&
          !openAIResult?.answer
            ? buildGroundedFallback({
                route,
                evidencePack,
                knowledgePack
              })
            : null;

        const answer =
          localAnswer ||
          structuredAnswer?.answer ||
          openAIResult?.answer ||
          fallbackAnswer ||
          `Prima routing preview: "${message}" → ${route}`;

        const response = buildResponse({
          conversationId,
          route,
          answer
        });

        response.meta.used_database =
          Boolean(
            knowledgePack
              .meta
              .used_database ||
            !statelessFastPath
          );

        response.meta.used_openai =
          Boolean(openAIResult?.used);

        const conversationPatch =
          buildConversationPatch(
            body,
            route
          );

        const persistenceTask =
          (async () => {
            try {
              const userRows =
                await supabaseInsert(
                  env,
                  "messages",
                  {
                    conversation_id:
                      conversationId,

                    role: "user",
                    content: message,
                    route,

                    page_id:
                      body?.page?.page_id ||
                      null,

                    page_type:
                      body?.page?.page_type ||
                      null,

                    primary_entity_type:
                      body?.entity
                        ?.primary_type ||
                      null,

                    primary_entity_slug:
                      body?.entity
                        ?.primary_slug ||
                      null,

                    secondary_entity_type:
                      body?.entity
                        ?.secondary_type ||
                      null,

                    secondary_entity_slug:
                      body?.entity
                        ?.secondary_slug ||
                      null,

                    metadata: {
                      contract:
                        "ContextEnvelopeV1"
                    }
                  },
                  "message_id,created_at"
                );

              const userMessageId =
                userRows?.[0]
                  ?.message_id ||
                null;

              await Promise.all([
                persistMemoryFacts(
                  env,
                  {
                    conversationId,

                    visitorId:
                      body?.visitor_id ||
                      null,

                    sourceMessageId:
                      userMessageId,

                    facts:
                      extractedFacts
                  }
                ),

                supabaseInsert(
                  env,
                  "messages",
                  {
                    conversation_id:
                      conversationId,

                    role:
                      "assistant",

                    content:
                      answer,

                    route,

                    response_type:
                      "answer",

                    page_id:
                      body?.page?.page_id ||
                      null,

                    page_type:
                      body?.page?.page_type ||
                      null,

                    primary_entity_type:
                      body?.entity
                        ?.primary_type ||
                      null,

                    primary_entity_slug:
                      body?.entity
                        ?.primary_slug ||
                      null,

                    secondary_entity_type:
                      body?.entity
                        ?.secondary_type ||
                      null,

                    secondary_entity_slug:
                      body?.entity
                        ?.secondary_slug ||
                      null,

                    used_openai:
                      Boolean(
                        openAIResult?.used
                      ),

                    used_database:
                      knowledgePack
                        .meta
                        .used_database,

                    used_search:
                      false,

                    metadata: {
                      contract:
                        "ResponseContractV1"
                    }
                  },
                  "message_id,created_at"
                ),

                supabaseInsert(
                  env,
                  "conversation_events",
                  {
                    conversation_id:
                      conversationId,

                    message_id:
                      userMessageId,

                    event_name:
                      "message_routed",

                    event_data: {
                      route,

                      allowed_tools:
                        allowedTools,

                      language:
                        body?.page
                          ?.language_code ||
                        "en"
                    }
                  },
                  "event_id"
                ),

                supabaseUpdate(
                  env,
                  "conversations",
                  `conversation_id=eq.${conversationId}`,
                  conversationPatch
                )
              ]);
            } catch (error) {
              console.error(
                "prima_background_persistence_failed",
                error
              );
            }
          })();

        if (ctx?.waitUntil) {
          ctx.waitUntil(
            persistenceTask
          );
        } else {
          void persistenceTask;
        }

        const responsePayload = {
          ...response
        };

        if (debugEnabled) {
          responsePayload.debug = {
            persistence_mode:
              "background",

            persistence_queued:
              true,

            allowed_tools:
              allowedTools,

            current_turn_memory_facts:
              extractedFacts.length,

            active_memory:
              activeMemory,

            context_envelope:
              contextEnvelope,

            knowledge_pack:
              knowledgePack,

            evidence_pack:
              evidencePack,

            openai:
              openAIResult
                ? {
                    model:
                      openAIResult.model,

                    reasoning_effort:
                      openAIResult.reasoning_effort,

                    latency_ms:
                      openAIResult.latency_ms,

                    response_id:
                      openAIResult.response_id,

                    usage:
                      openAIResult.usage
                  }
                : null
          };
        }

        return json(responsePayload);
      } catch (error) {
        console.error(error);

        return json(
          {
            ok: false,
            error: "message_processing_failed",
            ...(debugEnabled
              ? {
                  detail:
                    error?.message ||
                    String(error)
                }
              : {})
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
