const OPENAI_URL =
  "https://api.openai.com/v1/responses";

const MODEL =
  "gpt-6-luna";


const ROUTES = [
  "unsupported",
  "contact_intent",
  "follow_up",
  "compare",
  "recommendation",
  "property_search",
  "exact_fact",
  "market_question",
  "page_question"
];


const TOPICS = [
  "family_living",
  "investment",
  "risk",
  "financing",
  "location",
  "budget",
  "property_type",
  "developer",
  "market"
];


const FACTS = [
  "price",
  "handover",
  "developer",
  "location",
  "status",
  "bedrooms",
  "payment_plan",
  "availability",
  "service_charges",
  "unit_size",
  "amenities"
];


const MEMORY_KEYS = [
  "name",
  "budget_min_aed",
  "budget_max_aed",
  "bedrooms",
  "children_count",
  "buyer_goal",
  "financing",
  "preferred_location_text",
  "timeline"
];


const ENTITY_TYPES = [
  "project",
  "developer",
  "district",
  "buyer_scenario",
  "budget",
  "property_type",
  "origin",
  "unknown"
];


const INTERPRETATION_SCHEMA = {
  type: "object",
  additionalProperties: false,

  properties: {
    version: {
      type: "string",
      enum: ["RequestInterpreterV1"]
    },

    primary_route: {
      type: "string",
      enum: ROUTES
    },

    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 4,

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          route: {
            type: "string",
            enum: ROUTES
          },

          topics: {
            type: "array",
            items: {
              type: "string",
              enum: TOPICS
            }
          },

          requested_facts: {
            type: "array",
            items: {
              type: "string",
              enum: FACTS
            }
          },

          needs_clarification: {
            type: "boolean"
          },

          clarification_question: {
            type: ["string", "null"]
          }
        },

        required: [
          "route",
          "topics",
          "requested_facts",
          "needs_clarification",
          "clarification_question"
        ]
      }
    },

    entities: {
      type: "array",
      maxItems: 6,

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          type: {
            type: "string",
            enum: ENTITY_TYPES
          },

          name: {
            type: ["string", "null"]
          },

          slug: {
            type: ["string", "null"]
          },

          role: {
            type: "string",
            enum: [
              "primary",
              "secondary",
              "mentioned"
            ]
          }
        },

        required: [
          "type",
          "name",
          "slug",
          "role"
        ]
      }
    },

    constraints: {
      type: "object",
      additionalProperties: false,

      properties: {
        budget_min_aed: {
          type: ["number", "null"]
        },

        budget_max_aed: {
          type: ["number", "null"]
        },

        bedrooms: {
          type: ["number", "null"]
        },

        children_count: {
          type: ["number", "null"]
        },

        buyer_goal: {
          type: ["string", "null"]
        },

        location: {
          type: ["string", "null"]
        },

        developer: {
          type: ["string", "null"]
        },

        property_type: {
          type: ["string", "null"]
        },

        timeline: {
          type: ["string", "null"]
        }
      },

      required: [
        "budget_min_aed",
        "budget_max_aed",
        "bedrooms",
        "children_count",
        "buyer_goal",
        "location",
        "developer",
        "property_type",
        "timeline"
      ]
    },

    memory_candidates: {
      type: "array",
      maxItems: 8,

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          key: {
            type: "string",
            enum: MEMORY_KEYS
          },

          value: {
            type: "string"
          },

          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1
          }
        },

        required: [
          "key",
          "value",
          "confidence"
        ]
      }
    },

    overall_confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    }
  },

  required: [
    "version",
    "primary_route",
    "tasks",
    "entities",
    "constraints",
    "memory_candidates",
    "overall_confidence"
  ]
};


function extractOutputText(data) {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  for (const item of data?.output || []) {
    if (item?.type !== "message") {
      continue;
    }

    for (const content of item?.content || []) {
      if (
        content?.type === "output_text" &&
        typeof content?.text === "string"
      ) {
        return content.text.trim();
      }
    }
  }

  return "";
}


function compactMemory(memory = []) {
  return (memory || [])
    .filter(Boolean)
    .slice(0, 12)
    .map(item => ({
      key:
        item?.key ||
        item?.memory_key ||
        null,

      value:
        item?.value ??
        item?.memory_value ??
        null
    }));
}


function buildInput({
  message,
  page,
  entity,
  memory,
  fallbackRoute,
  fastGate
}) {
  return {
    message:
      String(message || ""),

    page: {
      id:
        page?.page_id || null,

      type:
        page?.page_type || null,

      url:
        page?.url_path ||
        page?.canonical_url_path ||
        null
    },

    entity: {
      type:
        entity?.primary_type || null,

      slug:
        entity?.primary_slug || null
    },

    memory:
      compactMemory(memory),

    route_hint:
      fallbackRoute || null,

    gate_reason:
      fastGate?.reason || null,

    gate_facts:
      fastGate?.exact_facts || []
  };
}


function instructions() {
  return [
    "You are Prima Request Interpreter.",
    "Decompose the user's message for Prima's backend.",
    "Do not answer the user.",
    "Do not retrieve data.",
    "Do not search.",
    "Do not invent facts.",
    "",
    "Create separate tasks only for materially different actions.",
    "Example: handover + call request = exact_fact + contact_intent.",
    "Multiple requested facts for the same entity may remain one exact_fact task.",
    "",
    "Use supplied current entity for 'this', 'it', or 'this project' when clear.",
    "Never invent a slug.",
    "If a named entity has no supplied slug, use its name and slug=null.",
    "",
    "Extract constraints once at top level.",
    "Use null when unknown.",
    "",
    "Memory candidates must be explicit durable user facts/preferences only.",
    "Do not infer durable buyer_goal merely because the user asks whether something suits a family.",
    "For example, 'good for my family?' means topic family_living, not automatically buyer_goal.",
    "Existing memory is context and must not be re-emitted unless the user changes it.",
    "",
    "Return concise structured JSON only."
  ].join("\n");
}


export async function interpretRequest({
  env,
  message,
  page,
  entity,
  memory = [],
  fallbackRoute = null,
  fastGate = null
}) {
  if (!env?.OPENAI_API_KEY) {
    throw new Error(
      "request_interpreter_openai_key_missing"
    );
  }

  const startedAt =
    Date.now();

  const response =
    await fetch(
      OPENAI_URL,
      {
        method: "POST",

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
            effort: "none"
          },

          instructions:
            instructions(),

          text: {
            format: {
              type: "json_schema",

              name:
                "prima_request_interpretation",

              strict: true,

              schema:
                INTERPRETATION_SCHEMA
            }
          },

          max_output_tokens: 500,

          input: JSON.stringify(
            buildInput({
              message,
              page,
              entity,
              memory,
              fallbackRoute,
              fastGate
            })
          )
        })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      `request_interpreter_http_${response.status}: ` +
      JSON.stringify(data).slice(
        0,
        1200
      )
    );
  }

  const text =
    extractOutputText(data);

  if (!text) {
    throw new Error(
      "request_interpreter_empty_output"
    );
  }

  let interpretation;

  try {
    interpretation =
      JSON.parse(text);
  } catch {
    throw new Error(
      "request_interpreter_invalid_json"
    );
  }

  return {
    interpretation,

    meta: {
      used_openai: true,

      model:
        data?.model || MODEL,

      reasoning_effort:
        "none",

      latency_ms:
        Date.now() - startedAt,

      response_id:
        data?.id || null,

      input_tokens:
        data?.usage?.input_tokens || 0,

      cached_tokens:
        data?.usage
          ?.input_tokens_details
          ?.cached_tokens || 0,

      output_tokens:
        data?.usage?.output_tokens || 0,

      reasoning_tokens:
        data?.usage
          ?.output_tokens_details
          ?.reasoning_tokens || 0,

      total_tokens:
        data?.usage?.total_tokens || 0
    }
  };
}
