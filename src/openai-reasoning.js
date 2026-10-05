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

    case "market_question":
    case "compare":
    case "recommendation":
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



export async function generatePrimaAnswer({
  env,
  route,
  evidencePack,
  deadlineMs = 900
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

  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      () =>
        controller.abort(),
      deadlineMs
    );

  let response;

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
                message:
                  evidencePack?.question ||
                  evidencePack?.request?.message ||
                  evidencePack?.message ||
                  "",
                evidencePack
              }),

            input: [
              {
                role: "user",
                content: [
                  {
                    type:
                      "input_text",

                    text:
                      "Use this Evidence Pack to answer the user's question:\n\n" +
                      JSON.stringify(
                        evidencePack
                      )
                  }
                ]
              }
            ]
          })
        }
      );
  } catch (error) {
    if (
      controller.signal.aborted ||
      error?.name ===
        "AbortError"
    ) {
      return {
        used: false,
        timed_out: true,
        answer: null,

        model: MODEL,

        reasoning_effort:
          effort,

        latency_ms:
          Date.now() -
          startedAt,

        response_id: null,

        usage: {
          input_tokens: 0,
          cached_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
          total_tokens: 0
        }
      };
    }

    throw error;
  } finally {
    clearTimeout(
      timeoutId
    );
  }


  const data =
    await response.json();


  if (!response.ok) {
    throw new Error(
      `openai_http_${response.status}: ` +
      JSON.stringify(data).slice(
        0,
        1200
      )
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
    timed_out: false,

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
          ?.total_tokens || 0
    }
  };
}
