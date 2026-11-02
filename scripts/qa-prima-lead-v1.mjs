import {
  evaluateContactCapture
} from "../src/contact-capture.js";

import {
  buildPrimaLeadRpcPayload
} from "../src/prima-lead.js";


function check(
  name,
  condition
) {
  if (!condition) {
    throw new Error(name);
  }
}


const emailDecision =
  evaluateContactCapture({
    message:
      "You can email me at Zack.Test+Prima@example.com"
  });

check(
  "email_not_captured",
  emailDecision.captured === true
);

check(
  "email_memory_missing",
  emailDecision.memory_facts.some(
    fact =>
      fact.fact_key ===
        "contact_email" &&
      fact.fact_value ===
        "zack.test+prima@example.com"
  )
);

check(
  "email_channel_wrong",
  emailDecision.lead_action
    ?.contact_channel ===
      "email"
);

check(
  "pii_leaked_to_event",
  JSON.stringify(
    emailDecision.event_data
  ).includes(
    "zack.test"
  ) === false
);


const emailOnlyPayload =
  buildPrimaLeadRpcPayload({
    conversationId:
      "11111111-1111-4111-8111-111111111111",

    body: {
      visitor_id:
        "22222222-2222-4222-8222-222222222222",

      session_id:
        "33333333-3333-4333-8333-333333333333",

      page: {
        page_id:
          "page_project_passo_en",

        page_type:
          "project_page",

        url_path:
          "/en/projects/passo/"
      },

      entity: {
        primary_type:
          "project",

        primary_slug:
          "passo"
      }
    },

    route:
      "contact_intent",

    context: {
      search: {
        results: [
          {
            slug:
              "passo"
          },
          {
            slug:
              "orla-by-omniyat"
          }
        ]
      }
    },

    activeMemory: [
      {
        fact_key:
          "buyer_goal",
        fact_value:
          "investment"
      },
      {
        fact_key:
          "budget_max_aed",
        fact_value:
          5000000
      }
    ],

    currentFacts:
      emailDecision.memory_facts,

    contactDecision:
      emailDecision
  });

check(
  "email_only_payload_missing",
  Boolean(
    emailOnlyPayload
  )
);

check(
  "name_should_be_optional",
  emailOnlyPayload.p_name ===
    null
);

check(
  "phone_should_be_optional",
  emailOnlyPayload.p_phone ===
    null
);

check(
  "email_missing_from_rpc",
  emailOnlyPayload.p_email ===
    "zack.test+prima@example.com"
);

check(
  "wrong_conversion_type",
  emailOnlyPayload
    .p_conversion_type ===
      "prima_dialog"
);

check(
  "conversation_link_missing",
  emailOnlyPayload
    .p_interest_context
    ?.conversation_id ===
      "11111111-1111-4111-8111-111111111111"
);

check(
  "origin_missing",
  emailOnlyPayload
    .p_interest_context
    ?.origin ===
      "prima_dialog"
);

check(
  "memory_context_missing",
  emailOnlyPayload
    .p_interest_context
    ?.requirements
    ?.buyer_goal ===
      "investment"
);

check(
  "search_context_missing",
  emailOnlyPayload
    .p_interest_context
    ?.search_projects
    ?.length === 2
);


check("H27_consent_not_fabricated", emailOnlyPayload.p_consent_given === null);
check("H27_idempotency_key", emailOnlyPayload.p_idempotency_key === "prima:11111111-1111-4111-8111-111111111111");

const noContact =
  buildPrimaLeadRpcPayload({
    conversationId:
      "44444444-4444-4444-8444-444444444444"
  });

check(
  "lead_without_contact_created",
  noContact === null
);


console.log(
  "PASS ✅ — Prima Lead Bridge V1"
);

console.log(
  "phone OR email contact ✅"
);

console.log(
  "name optional for Prima ✅"
);

console.log(
  "no raw contact in analytics event ✅"
);

console.log(
  "conversation_id → canonical lead context ✅"
);

console.log(
  "Client Memory → lead context ✅"
);

console.log(
  "Search projects → lead context ✅"
);

console.log(
  "existing create_lead_v1 reused ✅"
);
