import assert from "node:assert/strict";
import {
  decideNextActionV1,
  routeForNextActionV1
} from "../src/decision-policy.js";

const cases = [
  ["persona_question", "PERSONA"],
  ["exact_fact", "EXACT_FACT"],
  ["page_question", "KNOWLEDGE_QA"],
  ["market_question", "KNOWLEDGE_QA"],
  ["property_search", "SEARCH"],
  ["recommendation", "ADVISORY"],
  ["follow_up", "ADVISORY"],
  ["compare", "COMPARE"],
  ["contact_intent", "CONTACT"],
  ["unsupported", "OFF_TOPIC"]
];

for (const [route, expectedAction] of cases) {
  const decision = decideNextActionV1({ route });
  const finalRoute = routeForNextActionV1(decision, route);

  assert.equal(decision.action, expectedAction, route);
  assert.equal(finalRoute, route, route);

  console.log(`PASS ${route} -> ${decision.action} -> ${finalRoute}`);
}

const protectedPersona = decideNextActionV1({
  route: "persona_question",
  conversationMove: { move_type: "reference" },
  interpretation: {
    turn_kind: "profile_update",
    memory_candidates: [
      { key: "budget", value: "5000000", confidence: 0.95 }
    ]
  }
});

assert.equal(protectedPersona.action, "PERSONA");
assert.equal(
  routeForNextActionV1(protectedPersona, "persona_question"),
  "persona_question"
);

console.log("PASS — Persona priority over contextual overrides");
console.log("DECISION POLICY REGRESSION — PASS");
