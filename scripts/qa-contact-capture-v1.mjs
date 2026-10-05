import {
  evaluateContactCapture
} from "../src/contact-capture.js";


function check(
  name,
  condition
) {
  if (!condition) {
    throw new Error(name);
  }
}


function fact(
  result,
  key
) {
  return (
    result?.memory_facts || []
  ).find(
    item =>
      item?.fact_key === key
  );
}


function acceptedMemory() {
  return [
    {
      fact_key:
        "funnel_state",

      fact_value: {
        status:
          "handoff_accepted",

        cta_type:
          "quick_call",

        progress_score:
          2
      },

      confidence:
        0.99
    }
  ];
}


function evaluate(
  message,
  activeMemory = []
) {
  return evaluateContactCapture({
    message,
    activeMemory,

    funnelDecision: {
      memory_facts: []
    }
  });
}


/*
  1. Accepted handoff → local UAE number.
*/
const acceptedLocal =
  evaluate(
    "0501234567",
    acceptedMemory()
  );

check(
  "accepted_local_not_captured",
  acceptedLocal?.captured === true
);

check(
  "accepted_local_wrong_phone",
  fact(
    acceptedLocal,
    "contact_phone"
  )?.fact_value ===
    "0501234567"
);

check(
  "accepted_local_no_lead_action",
  acceptedLocal
    ?.lead_action
    ?.type ===
      "capture_lead"
);

check(
  "accepted_local_not_immediate",
  acceptedLocal
    ?.lead_action
    ?.status ===
      "contact_received"
);

check(
  "accepted_local_no_time_followup",
  /convenient time/i.test(
    acceptedLocal?.follow_up || ""
  )
);


/*
  2. International number normalization.
*/
const international =
  evaluate(
    "+971 50 123 4567",
    acceptedMemory()
  );

check(
  "international_not_captured",
  international?.captured === true
);

check(
  "international_not_normalized",
  fact(
    international,
    "contact_phone"
  )?.fact_value ===
    "+971501234567"
);


/*
  3. Voluntary WhatsApp is valid even before
  an explicit handoff.
*/
const voluntaryWhatsApp =
  evaluate(
    "WhatsApp me on +44 7700 900123"
  );

check(
  "voluntary_whatsapp_not_captured",
  voluntaryWhatsApp?.captured === true
);

check(
  "voluntary_whatsapp_wrong_phone",
  fact(
    voluntaryWhatsApp,
    "contact_phone"
  )?.fact_value ===
    "+447700900123"
);

check(
  "whatsapp_channel_missing",
  fact(
    voluntaryWhatsApp,
    "preferred_contact_channel"
  )?.fact_value ===
    "whatsapp"
);


/*
  4. Explicit phone cue works without prior
  handoff because the user volunteered contact.
*/
const voluntaryPhone =
  evaluate(
    "My phone number is 050 123 4567"
  );

check(
  "voluntary_phone_not_captured",
  voluntaryPhone?.captured === true
);

check(
  "voluntary_phone_wrong_value",
  fact(
    voluntaryPhone,
    "contact_phone"
  )?.fact_value ===
    "0501234567"
);


/*
  5. Property numbers / budgets must not become
  contact data.
*/
for (const value of [
  "My budget is AED 6000000",
  "Budget around AED 4500000",
  "The handover is in 2029",
  "AED 9.4M"
]) {
  const result =
    evaluate(value);

  check(
    `false_positive_${value}`,
    result?.captured !== true
  );
}


/*
  6. Arbitrary bare digits are not contact
  unless Prima is actually awaiting contact.
*/
const arbitraryDigits =
  evaluate(
    "12345678"
  );

check(
  "arbitrary_digits_false_positive",
  arbitraryDigits?.captured !== true
);


/*
  7. But after accepted handoff a bare number
  is exactly the expected reply.
*/
const expectedBare =
  evaluate(
    "12345678",
    acceptedMemory()
  );

check(
  "expected_bare_not_captured",
  expectedBare?.captured === true
);


/*
  8. Contact capture advances funnel state.
*/
const capturedState =
  fact(
    acceptedLocal,
    "funnel_state"
  );

check(
  "funnel_not_contact_captured",
  capturedState
    ?.fact_value
    ?.status ===
      "contact_captured"
);


/*
  9. Analytics/event payload must never contain
  the raw phone number.
*/
const eventJson =
  JSON.stringify(
    acceptedLocal?.event_data || {}
  );

check(
  "raw_phone_in_event",
  !eventJson.includes(
    "0501234567"
  )
);

const allowedEventKeys =
  new Set([
    "has_contact",
    "contact_channel",
    "source"
  ]);

check(
  "unexpected_contact_event_field",
  Object.keys(
    acceptedLocal?.event_data || {}
  ).every(
    key =>
      allowedEventKeys.has(key)
  )
);

check(
  "event_missing_contact_flag",
  acceptedLocal
    ?.event_data
    ?.has_contact === true
);


/*
  10. Critical combined-message case:
  capture contact immediately, but DO NOT replace
  the user's actual property question with a
  generic thank-you.
*/
const combined =
  evaluate(
    "My WhatsApp is +971 50 123 4567. Is Passo available?"
  );

check(
  "combined_contact_not_captured",
  combined?.captured === true
);

check(
  "combined_question_hijacked",
  combined?.answer_override == null
);

check(
  "combined_question_followup_hijacked",
  combined?.follow_up == null
);

check(
  "combined_lead_not_immediate",
  combined
    ?.lead_action
    ?.type ===
      "capture_lead"
);


/*
  11. Contact-only message may be acknowledged.
*/
check(
  "contact_only_no_ack",
  typeof voluntaryWhatsApp
    ?.answer_override ===
      "string"
);


/*
  12. Preferred time is enrichment only.
  Lead is already captured before it exists.
*/
check(
  "lead_waiting_for_preferred_time",
  acceptedLocal
    ?.lead_action
    ?.status ===
      "contact_received"
);


console.log(
  "PASS ✅ — Handoff / Contact Capture V1"
);

console.log(
  "accepted handoff → phone captured ✅"
);

console.log(
  "WhatsApp / phone voluntary capture ✅"
);

console.log(
  "budget / property-number guards ✅"
);

console.log(
  "raw phone absent from analytics event ✅"
);

console.log(
  "phone + property question preserved ✅"
);

console.log(
  "lead captured before preferred time ✅"
);
