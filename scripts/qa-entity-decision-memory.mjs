import {
  extractEntityDecisionFacts,
  hasEntityDecisionSignal
} from "../src/entity-decision-memory.js";


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


function factsByKey(
  facts
) {
  return Object.fromEntries(
    facts.map(
      item => [
        item.fact_key,
        item
      ]
    )
  );
}


const currentPasso = {
  entity: {
    primary_type:
      "project",
    primary_slug:
      "passo"
  },

  conversation: {
    recent_messages: []
  }
};


const currentPassoRecentOrla = {
  entity: {
    primary_type:
      "project",
    primary_slug:
      "passo"
  },

  conversation: {
    recent_messages: [
      {
        role: "user",
        content:
          "Tell me about Orla",
        primary_entity_type:
          "project",
        primary_entity_slug:
          "orla-by-omniyat"
      }
    ]
  }
};


const districtContext = {
  entity: {
    primary_type:
      "district",
    primary_slug:
      "dubai-hills-estate"
  },

  conversation: {
    recent_messages: []
  }
};


/*
  ---------------------------------------------------------
  1. Decision turns must be detected.
  ---------------------------------------------------------
*/

check(
  "interest_signal",
  hasEntityDecisionSignal(
    "I like this one"
  ) === true
);

check(
  "shortlist_signal",
  hasEntityDecisionSignal(
    "Put Passo on my shortlist"
  ) === true
);

check(
  "rejection_signal",
  hasEntityDecisionSignal(
    "I don't like this one because the handover is too early."
  ) === true
);

check(
  "ordinary_fact_not_decision",
  hasEntityDecisionSignal(
    "Does Passo have 2BR?"
  ) === false
);


/*
  ---------------------------------------------------------
  2. Current resolved project → interested.
  ---------------------------------------------------------
*/

const interested =
  factsByKey(
    extractEntityDecisionFacts({
      message:
        "I like this one",
      context:
        currentPasso
    })
  );

check(
  "interested_mentioned_missing",
  Boolean(
    interested[
      "project_mentioned:passo"
    ]
  )
);

check(
  "interested_status",
  interested[
    "project_decision:passo"
  ]?.fact_value?.status ===
    "interested"
);


/*
  ---------------------------------------------------------
  3. Explicit current project → shortlisted.
  ---------------------------------------------------------
*/

const shortlisted =
  factsByKey(
    extractEntityDecisionFacts({
      message:
        "Put Passo on my shortlist",
      context:
        currentPasso
    })
  );

check(
  "shortlist_status",
  shortlisted[
    "project_decision:passo"
  ]?.fact_value?.status ===
    "shortlisted"
);


/*
  ---------------------------------------------------------
  4. Rejection + exact user reason.
  ---------------------------------------------------------
*/

const rejected =
  factsByKey(
    extractEntityDecisionFacts({
      message:
        "I don't like this one because the handover is too early.",
      context:
        currentPasso
    })
  );

check(
  "rejection_status",
  rejected[
    "project_decision:passo"
  ]?.fact_value?.status ===
    "rejected"
);

check(
  "rejection_reason",
  rejected[
    "project_decision:passo"
  ]?.fact_value?.reason ===
    "the handover is too early"
);


/*
  ---------------------------------------------------------
  5. Short natural rejection on current project.
  ---------------------------------------------------------
*/

const notForMe =
  factsByKey(
    extractEntityDecisionFacts({
      message:
        "Not for me.",
      context:
        currentPasso
    })
  );

check(
  "not_for_me_rejection",
  notForMe[
    "project_decision:passo"
  ]?.fact_value?.status ===
    "rejected"
);


/*
  ---------------------------------------------------------
  6. Referential "it" prefers recent resolved entity.
  Current page = Passo
  Recent entity = Orla
  ---------------------------------------------------------
*/

const recentOrla =
  factsByKey(
    extractEntityDecisionFacts({
      message:
        "I like it",
      context:
        currentPassoRecentOrla
    })
  );

check(
  "recent_orla_interested",
  recentOrla[
    "project_decision:orla-by-omniyat"
  ]?.fact_value?.status ===
    "interested"
);

check(
  "recent_reference_not_passo",
  !Object.prototype
    .hasOwnProperty.call(
      recentOrla,
      "project_decision:passo"
    )
);


/*
  ---------------------------------------------------------
  7. Critical wrong-project guard.
  Current resolved project = Passo,
  but user explicitly says Orla.
  Do NOT silently assign Orla decision to Passo.
  ---------------------------------------------------------
*/

const unresolvedOtherProject =
  extractEntityDecisionFacts({
    message:
      "I like Orla",
    context:
      currentPasso
  });

check(
  "wrong_project_guard",
  unresolvedOtherProject.length === 0
);


/*
  ---------------------------------------------------------
  8. Explicit unresolved project with no context.
  No guessing / slug fabrication.
  ---------------------------------------------------------
*/

const noContext =
  extractEntityDecisionFacts({
    message:
      "I like Passo",
    context: {
      entity: {
        primary_type: null,
        primary_slug: null
      },
      conversation: {
        recent_messages: []
      }
    }
  });

check(
  "unresolved_project_guard",
  noContext.length === 0
);


/*
  ---------------------------------------------------------
  9. Plain resolved mention → mentioned.
  ---------------------------------------------------------
*/

const mentioned =
  factsByKey(
    extractEntityDecisionFacts({
      message:
        "Tell me about Passo",
      context:
        currentPasso
    })
  );

check(
  "mentioned_status",
  mentioned[
    "project_decision:passo"
  ]?.fact_value?.status ===
    "mentioned"
);


/*
  ---------------------------------------------------------
  10. Mention must NOT downgrade an existing stronger state.
  ---------------------------------------------------------
*/

const afterShortlistMention =
  factsByKey(
    extractEntityDecisionFacts({
      message:
        "Tell me about Passo",
      context:
        currentPasso,
      activeMemory: [
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
      ]
    })
  );

check(
  "mention_still_recorded",
  Boolean(
    afterShortlistMention[
      "project_mentioned:passo"
    ]
  )
);

check(
  "shortlist_not_downgraded",
  !Object.prototype
    .hasOwnProperty.call(
      afterShortlistMention,
      "project_decision:passo"
    )
);


/*
  ---------------------------------------------------------
  11. Non-project context must not create project memory.
  ---------------------------------------------------------
*/

const districtDecision =
  extractEntityDecisionFacts({
    message:
      "I like this one",
    context:
      districtContext
  });

check(
  "district_not_project_memory",
  districtDecision.length === 0
);


console.log(
  "PASS ✅ — Entity Decision Memory V1"
);

console.log(
  "mentioned → PASS ✅"
);

console.log(
  "interested → PASS ✅"
);

console.log(
  "shortlisted → PASS ✅"
);

console.log(
  "rejected + reason → PASS ✅"
);

console.log(
  "recent resolved entity → PASS ✅"
);

console.log(
  "wrong-project guard → PASS ✅"
);

console.log(
  "unresolved-project guard → PASS ✅"
);

console.log(
  "no-downgrade guard → PASS ✅"
);
