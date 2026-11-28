import assert from "node:assert/strict";
import { routeIntent } from "../src/router.js";

const protectedCases = [
  ["Property search", "Find apartments in Dubai Marina under AED 3 million", "property_search"],
  ["District search", "Find districts in Abu Dhabi", "property_search"],
  ["Developer search", "Find developers in the UAE", "property_search"],
  ["Persona", "Who are you?", "persona_question"],
  ["Greeting", "Hello", "persona_question"],
  ["Contact", "Can an agent contact me?", "contact_intent"],
  ["Comparison", "Compare Dubai Marina and Downtown Dubai", "compare"],
  ["Recommendation", "Recommend apartments in Dubai Hills Estate", "recommendation"],
  ["Pagination", "Show 3 more", "property_search"]
];

const diagnosticCases = [
  ["A04", "I'm interested in Emaar's apartments near Dubai Creek Harbour, but nothing above AED 3 million."],
  ["B02", "I'm trying to understand who is behind Faya Al Saadiyat."],
  ["B04", "Is Saadiyat Island more of a residential area or just a tourist destination?"],
  ["B05", "I'd like to explore neighbourhoods around Abu Dhabi rather than specific developments."],
  ["C01", "I'm interested in Faya Al Saadiyat. Who built it, and what else has that developer done in Saadiyat?"],
  ["D02", "Forget the previous budget. What if I can spend up to AED 5 million instead?"]
];

let passed = 0;
let failed = 0;

console.log("\n=== PROTECTED ROUTER REGRESSIONS ===");

for (const [name, message, expected] of protectedCases) {
  const actual = routeIntent(message, {});
  if (actual === expected) {
    passed++;
    console.log("PASS", name, "=>", actual);
  } else {
    failed++;
    console.log("FAIL", name, "expected:", expected, "actual:", actual);
  }
}

console.log("\n=== DIAGNOSTICS — NOT YET ASSERTED ===");

for (const [name, message] of diagnosticCases) {
  console.log(name, "=>", routeIntent(message, {}));
}

console.log("\nPROTECTED:", passed, "PASS /", failed, "FAIL");
console.log("NOTE: Router-only tests; no live Search, Memory or pagination execution.");

assert.equal(failed, 0, "Protected Router regression detected");
