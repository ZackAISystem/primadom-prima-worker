import { buildPersonaInstructions } from "./persona-runtime.js";

const OPENAI_URL =
  "https://api.openai.com/v1/responses";

const MODEL =
  "gpt-6-luna";


function getReasoningEffort(route) {
  switch (route) {
    case "page_question":
    case "follow_up":
      return "none";

    case "recommendation":
      return "none";

    case "market_question":
    case "compare":
      return "low";

    default:
      return "none";
  }
}


export function shouldUseOpenAI({
  route,
  evidencePack,
  knowledgePack
}) {
  if (route === "exact_fact") {
    return false;
  }

  if (
    route === "market_question" &&
    knowledgePack
      ?.meta
      ?.market_verified !== true
  ) {
    return false;
  }

  /*
    A plain factual comparison does not need
    an LLM. Topic-specific comparison can use
    reasoning later when it materially helps.
  */
  if (
    route === "compare" &&
    (
      knowledgePack
        ?.planner
        ?.topics
        ?.length || 0
    ) === 0
  ) {
    return false;
  }

  const supported =
    new Set([
      "page_question",
      "follow_up",
      "market_question",
      "compare",
      "recommendation"
    ]);

  if (!supported.has(route)) {
    return false;
  }

  if (
    knowledgePack
      ?.planner
      ?.reasoning_required !== true
  ) {
    return false;
  }

  return (
    evidencePack
      ?.meta
      ?.source_count > 0
  );
}


function extractOutputText(data) {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  const texts = [];

  for (const item of data?.output || []) {
    if (item?.type !== "message") {
      continue;
    }

    for (const content of item?.content || []) {
      if (
        content?.type === "output_text" &&
        typeof content?.text === "string"
      ) {
        texts.push(content.text);
      }
    }
  }

  return texts.join("\n").trim();
}



// Bound evidence text without changing fact provenance or inventing values.
// Truncation is explicit; the model must not infer details that were omitted.
function compactEvidenceText(value, maxChars = 1200) {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const wordEnd = slice.lastIndexOf(" ");
  return (wordEnd > maxChars * 0.7 ? slice.slice(0, wordEnd) : slice).trim() +
    " [additional verified detail omitted]";
}

function compactSourceItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.map(item => compactEvidenceText(item?.value ?? item?.text ?? ""))
    .filter(value => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, 6);
}

function compactReasoningEvidence(
  evidencePack = {}
) {
  const sources =
    Array.isArray(
      evidencePack?.sources
    )
      ? evidencePack.sources
          .slice(0, 8)
          .map(source => ({
            role:
              source?.role || null,

            entity_type:
              source?.entity_type || null,

            entity_name:
              source?.entity_name || null,

            items: compactSourceItems(source?.items)
          }))
          .filter(
            source =>
              source.items.length > 0
          )
      : [];

  const memory =
    Array.isArray(
      evidencePack?.memory
    )
      ? evidencePack.memory
          .slice(0, 12)
          .map(item => ({
            key:
              item?.key ??
              item?.fact_key ??
              null,

            value:
              item?.value ??
              item?.fact_value ??
              null
          }))
          .filter(item =>
            typeof item.key === "string" &&
            item.value !== null &&
            item.value !== undefined &&
            String(item.value).trim() !== "" &&
            !/^(?:name|user_name|phone|email|whatsapp|contact(?:_|$)|lead(?:_|$)|funnel(?:_|$))/i.test(item.key)
          )
      : [];

  return {
    question:
      evidencePack?.question ||
      evidencePack?.request?.message ||
      evidencePack?.message ||
      "",

    route:
      evidencePack?.route ||
      null,

    entity:
      evidencePack?.entity ||
      null,

    relation:
      evidencePack
        ?.selected_context
        ?.relation ||
      null,

    memory,

    sources,

    // F22_RECOMMENDATION_SHORTLIST_EVIDENCE_V1
    // Preserve catalog identities for the shared Final Composer.
    // No extra OpenAI request. No live availability claims.
    ...(
      evidencePack?.route === "recommendation" &&
      evidencePack?.search_context?.entity_type === "project" &&
      Array.isArray(evidencePack.search_context.results)
        ? {
            recommendation_shortlist: {
              source:
                evidencePack.search_context.source || null,

              evidence_status:
                "catalog_snapshot_not_live_availability",

              requested_count:
                Number.isInteger(
                  Number(evidencePack.search_context.requested_count)
                ) &&
                Number(evidencePack.search_context.requested_count) >= 1 &&
                Number(evidencePack.search_context.requested_count) <= 10
                  ? Number(evidencePack.search_context.requested_count)
                  : null,

              selected_count:
                Math.min(
                  evidencePack.search_context.results.length,
                  10
                ),

              projects:
                evidencePack.search_context.results
                  .slice(0, 10)
                  .map((project, index) => ({
                    rank:
                      Number(project?.rank) > 0
                        ? Number(project.rank)
                        : index + 1,

                    title:
                      String(
                        project?.title ||
                        project?.card?.title ||
                        ""
                      ).trim() || null,

                    slug:
                      String(project?.slug || "").trim() || null,

                    page_id:
                      String(project?.page_id || "").trim() || null,

                    canonical_url:
                      String(
                        project?.canonical_url ||
                        project?.url_path ||
                        ""
                      ).trim() || null,

                    district:
                      project?.district || null,

                    developer:
                      project?.developer || null,

                    property_type:
                      project?.machine_property_type ||
                      project?.property_type ||
                      null,

                    catalog_starting_price:
                      project?.price_display || null
                  }))
            }
          }
        : {}
    )
  };
}


export async function generatePrimaAnswer({
  env,
  route,
  nextAction = null,
  evidencePack,
  commercialDirective = null,
  deadlineMs = 2500
}) {
  const startedAt =
    Date.now();

  if (!env?.OPENAI_API_KEY) {
    throw new Error(
      "openai_api_key_missing"
    );
  }

  const effort =
    getReasoningEffort(route);

  const reasoningEvidence =
    compactReasoningEvidence(
      evidencePack
    );

  // G43_DYNAMIC_COMMERCIAL_CONTEXT_V1
  if (commercialDirective?.decision === "offer_contact") {
    reasoningEvidence.commercial_next_step = {
      decision: "offer_contact",
      commercial_needs:
        commercialDirective.commercial_needs || [],
      project:
        commercialDirective.project || null,
      known_requirements:
        commercialDirective.known_requirements || {},
      grounded_base_answer:
        String(commercialDirective.grounded_base_answer || "")
          .slice(0, 900)
    };
  }

  const reasoningInput =
    JSON.stringify(
      reasoningEvidence
    );

  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      () =>
        controller.abort(),
      deadlineMs
    );

  let response;
  let data;

  try {
    response =
      await fetch(
        OPENAI_URL,
        {
          method: "POST",

          signal:
            controller.signal,

          headers: {
            "Authorization":
              `Bearer ${env.OPENAI_API_KEY}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            model: MODEL,

            store: false,

            reasoning: {
              effort,
              mode: "standard"
            },

            text: {
              verbosity: "low"
            },

            max_output_tokens: 180,

            instructions:
              buildPersonaInstructions({
                route,
                nextAction,
                message:
                  evidencePack?.question ||
                  evidencePack?.request?.message ||
                  evidencePack?.message ||
                  "",
                evidencePack
              }) +
              (commercialDirective?.decision === "offer_contact"
                ? `\nAPPROVED FUNNEL OFFER: The Funnel authorizes one optional human specialist offer. Answer the actual question first using verified facts; retain any material uncertainty or risk. Do not invite the user to contact a specialist, advisor, agent or team. The Funnel alone appends a single approved contact invitation. Provide only the substantive answer and any necessary uncertainty. Never request contact details, imply confirmation, invent terms/availability or pressure the user. No generic sales pitch.`
                : ""
              ),

            input: [
              {
                role: "user",
                content: [
                  {
                    type:
                      "input_text",

                    text:
                      "Respond to the user's current turn using only this verified compact evidence. Follow the CURRENT ACTION in the instructions and do not invent facts:\\n\\n" +
                      reasoningInput
                  }
                ]
              }
            ]
          })
        }
      );
    data = await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        if (controller.signal.aborted) {
          reject(Object.assign(new Error("composer_deadline_exceeded"), {name: "AbortError"}));
          return;
        }
        controller.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("composer_deadline_exceeded"), {name: "AbortError"})),
          {once: true});
      })
    ]);
  } catch (error) {
    if (
      controller.signal.aborted ||
      error?.name ===
        "AbortError"
    ) {
      return {
        used: false,
        attempted: true,
        timed_out: true,
        usage_unknown: true,
        answer: null,

        model: MODEL,

        reasoning_effort:
          effort,

        latency_ms:
          Date.now() -
          startedAt,

        response_id: null,

        usage: {
          input_tokens: null,
          cached_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
          total_tokens: null
        }
      };
    }

    throw error;
  } finally {
    clearTimeout(
      timeoutId
    );
  }





  if (!response.ok) {
    throw new Error(
      `openai_http_${response.status}`
    );
  }


  const answer =
    extractOutputText(data);


  if (!answer) {
    throw new Error(
      "openai_empty_answer"
    );
  }


  return {
    used: true,
    attempted: true,
    timed_out: false,
    usage_unknown: !Number.isFinite(data?.usage?.total_tokens),

    answer,

    model:
      data?.model || MODEL,

    reasoning_effort:
      effort,

    latency_ms:
      Date.now() -
      startedAt,

    response_id:
      data?.id || null,

    usage: {
      input_tokens:
        data?.usage
          ?.input_tokens || 0,

      cached_tokens:
        data?.usage
          ?.input_tokens_details
          ?.cached_tokens || 0,

      output_tokens:
        data?.usage
          ?.output_tokens || 0,

      reasoning_tokens:
        data?.usage
          ?.output_tokens_details
          ?.reasoning_tokens || 0,

      total_tokens:
        data?.usage
          ?.total_tokens ?? null
    }
  };
}
