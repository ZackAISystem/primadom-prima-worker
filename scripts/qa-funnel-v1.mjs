import {
  evaluateFunnel,
  hasImmediateCommercialSignal
} from "../src/funnel.js";


function check(
  name,
  condition
) {
  if (!condition) {
    throw new Error(
      `FAIL ❌ — ${name}`
    );
  }
}


function funnelState(
  status,
  ctaType,
  score
) {
  return {
    fact_key:
      "funnel_state",

    fact_value: {
      status,
      cta_type:
        ctaType,
      progress_score:
        score
    }
  };
}


function stateFrom(
  decision
) {
  return decision
    ?.memory_facts
    ?.find(
      item =>
        item.fact_key ===
          "funnel_state"
    )
    ?.fact_value;
}


/*
  1. Ordinary first factual question:
  NO automatic CTA.
*/
const ordinaryFact =
  evaluateFunnel({
    message:
      "When is Passo handover?",
    route:
      "exact_fact",
    activeMemory: [],
    fullContext:
      true
  });

check(
  "ordinary_fact_no_cta",
  ordinaryFact.follow_up === null
);

check(
  "ordinary_fact_no_lead_action",
  ordinaryFact.lead_action === null
);


/*
  2. Strong commercial first message
  must be recognized immediately.
*/
check(
  "availability_immediate_signal",
  hasImmediateCommercialSignal({
    message:
      "Is Passo available now?",
    route:
      "exact_fact"
  }) === true
);

const availability =
  evaluateFunnel({
    message:
      "Is Passo available now?",
    route:
      "exact_fact",
    activeMemory: [],
    fullContext:
      true
  });

check(
  "availability_first_cta",
  /latest availability/i.test(
    availability.follow_up || ""
  )
);

check(
  "availability_state_offered",
  stateFrom(
    availability
  )?.status ===
    "cta_offered"
);


/*
  3. Payment plan can CTA on first answer.
*/
const paymentPlan =
  evaluateFunnel({
    message:
      "What is the payment plan?",
    route:
      "exact_fact",
    activeMemory: [],
    fullContext:
      true
  });

check(
  "payment_plan_first_cta",
  /current terms/i.test(
    paymentPlan.follow_up || ""
  )
);


/*
  4. First comparison is meaningful value.
*/
check(
  "compare_immediate_signal",
  hasImmediateCommercialSignal({
    message:
      "Passo vs Orla",
    route:
      "compare"
  }) === true
);

const comparison =
  evaluateFunnel({
    message:
      "Passo vs Orla",
    route:
      "compare",
    activeMemory: [],
    fullContext:
      true
  });

check(
  "comparison_first_cta",
  /Primadom advisor/i.test(
    comparison.follow_up || ""
  )
);


/*
  5. Strong project buying question
  may CTA immediately.
*/
const goodInvestment =
  evaluateFunnel({
    message:
      "Is this a good investment?",
    route:
      "page_question",
    activeMemory: [],
    fullContext:
      true
  });

check(
  "commercial_analysis_first_cta",
  /Primadom specialist/i.test(
    goodInvestment.follow_up || ""
  )
);


/*
  6. Shortlist can CTA.
*/
const shortlistMemory = [
  {
    fact_key:
      "project_decision:passo",

    fact_value: {
      entity_type:
        "project",
      entity_slug:
        "passo",
      status:
        "shortlisted",
      reason:
        null
    }
  }
];

const shortlist =
  evaluateFunnel({
    message:
      "What about another option?",
    route:
      "follow_up",
    activeMemory:
      shortlistMemory,
    fullContext:
      true
  });

check(
  "shortlist_cta",
  /go through these options/i
    .test(
      shortlist.follow_up || ""
    )
);


/*
  7. Ignored CTA is NOT rejection,
  but the same CTA must not repeat
  without meaningful progress.
*/
const ignored =
  evaluateFunnel({
    message:
      "Is it still available?",
    route:
      "exact_fact",
    activeMemory: [
      funnelState(
        "cta_offered",
        "availability_check",
        0
      )
    ],
    fullContext:
      true
  });

check(
  "ignored_cta_not_repeated",
  ignored.follow_up === null
);

check(
  "ignored_cta_not_declined",
  ignored.memory_facts.length === 0
);


/*
  8. New meaningful progress allows
  a later re-offer.
*/
const progressed =
  evaluateFunnel({
    message:
      "Is it still available?",
    route:
      "exact_fact",
    activeMemory: [
      funnelState(
        "cta_offered",
        "availability_check",
        0
      ),
      {
        fact_key:
          "budget_max_aed",
        fact_value:
          6000000
      }
    ],
    fullContext:
      true
  });

check(
  "progress_allows_reoffer",
  /latest availability/i.test(
    progressed.follow_up || ""
  )
);


/*
  9. Explicit NOT NOW.
*/
const declined =
  evaluateFunnel({
    message:
      "Not now",
    route:
      "page_question",
    activeMemory: [
      funnelState(
        "cta_offered",
        "project_consultation",
        2
      )
    ],
    fullContext:
      true
  });

check(
  "decline_no_pressure",
  /keep working through it here/i
    .test(
      declined.answer_override || ""
    )
);

check(
  "decline_state",
  stateFrom(
    declined
  )?.status ===
    "cta_declined"
);

check(
  "decline_no_lead_action",
  declined.lead_action === null
);


/*
  10. YES after CTA = accepted handoff.
*/
const accepted =
  evaluateFunnel({
    message:
      "Yes, please",
    route:
      "page_question",
    activeMemory: [
      funnelState(
        "cta_offered",
        "availability_check",
        2
      )
    ],
    fullContext:
      true
  });

check(
  "accepted_response_type",
  accepted.response_type ===
    "lead_transition"
);

check(
  "accepted_asks_phone_whatsapp",
  /phone number or WhatsApp/i
    .test(
      accepted.follow_up || ""
    )
);

check(
  "accepted_lead_action",
  accepted
    .lead_action
    ?.type ===
      "request_contact"
);

check(
  "accepted_state",
  stateFrom(
    accepted
  )?.status ===
    "handoff_accepted"
);


/*
  11. Direct call request does not
  require a previous CTA.
*/
const directCall =
  evaluateFunnel({
    message:
      "Please call me",
    route:
      "contact_intent",
    activeMemory: [],
    fullContext:
      true
  });

check(
  "direct_call_transition",
  directCall.response_type ===
    "lead_transition"
);

check(
  "direct_call_asks_contact",
  /phone number or WhatsApp/i
    .test(
      directCall.follow_up || ""
    )
);


/*
  12. Once accepted, don't show
  another CTA while waiting for contact.
*/
const waitingForContact =
  evaluateFunnel({
    message:
      "What about availability?",
    route:
      "exact_fact",
    activeMemory: [
      funnelState(
        "handoff_accepted",
        "availability_check",
        2
      )
    ],
    fullContext:
      true
  });

check(
  "no_cta_after_acceptance",
  waitingForContact.follow_up ===
    null
);


/*
  13. Fast-path contract:
  ordinary exact fact stays fast;
  strong commercial signal exits fast
  for Funnel state, not for LLM.
*/
check(
  "ordinary_fact_not_immediate",
  hasImmediateCommercialSignal({
    message:
      "When is Passo handover?",
    route:
      "exact_fact"
  }) === false
);

check(
  "payment_plan_immediate",
  hasImmediateCommercialSignal({
    message:
      "What is the payment plan?",
    route:
      "exact_fact"
  }) === true
);


console.log(
  "PASS ✅ — Funnel / CTA V1"
);
console.log(
  "First meaningful CTA → PASS ✅"
);
console.log(
  "Ordinary fact no forced CTA → PASS ✅"
);
console.log(
  "Comparison first CTA → PASS ✅"
);
console.log(
  "Shortlist CTA → PASS ✅"
);
console.log(
  "Ignored CTA no repetition → PASS ✅"
);
console.log(
  "Meaningful progress re-offer → PASS ✅"
);
console.log(
  "Not now / no pressure → PASS ✅"
);
console.log(
  "Accepted → phone / WhatsApp → PASS ✅"
);
console.log(
  "Direct call handoff → PASS ✅"
);
