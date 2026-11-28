import { readFileSync } from "node:fs";
import { generate } from "../../../src/persona-semantic-a1.js";

const envText = readFileSync(".dev.vars", "utf8");

function readVar(name) {
  const line = envText.split(/\r?\n/).find(s =>
    new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(s)
  );
  if (!line) return null;
  let value = line.replace(/^\s*(?:export\s+)?[A-Z0-9_]+\s*=/, "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

const apiKey = readVar("OPENAI_API_KEY");

if (!apiKey) {
  console.error("BLOCKED: OPENAI_API_KEY missing");
  process.exit(1);
}

const env = {
  OPENAI_API_KEY: apiKey,
  PRIMA_PERSONA_MODEL: readVar("PRIMA_PERSONA_MODEL") || "gpt-6-luna",
  PRIMA_PERSONA_REASONING_EFFORT:
    readVar("PRIMA_PERSONA_REASONING_EFFORT") || "low"
};

const message = "Explain what rental yield means.";
const routeHint = "market_question";

const context = {
  page: {
    language_code: "en"
  },
  conversation: {
    recent_messages: [],
    dialogue_state: {
      request_state: {
        property_type: null,
        location: null,
        bedrooms: null,
        budget: {
          min_aed: null,
          max_aed: null
        }
      }
    }
  }
};

let apiCalls = 0;

const safeFetch = (url, options) => {
  if (String(url) !== "https://api.openai.com/v1/responses") {
    throw Error("QA_NETWORK_BOUNDARY_BLOCKED");
  }
  apiCalls += 1;
  if (apiCalls > 1) {
    throw Error("QA_MAX_OPENAI_CALLS_EXCEEDED");
  }
  return fetch(url, options);
};

console.log("===== PRIMA FULL PIPELINE TRACE QA =====");
console.log("RUN: 002");
console.log("STAGE: LIVE LUNA");
console.log("SCENARIO: R04 — concept_explanation");
console.log("MESSAGE:", message);
console.log("ROUTE HINT:", routeHint);
console.log("MODEL:", env.PRIMA_PERSONA_MODEL);

const result = await generate({
  env,
  message,
  context,
  memory: [],
  route: routeHint,
  dialogueMode: false,
  fetchFn: safeFetch
});

const interpretation = result.interpretation || {};
const decision = interpretation.luna_decision || result.luna_decision || {};

const actual = {
  module: "src/persona-semantic-a1.js",
  function: "generate",
  decision: result.decision,
  primary_route: interpretation.primary_route ?? null,
  next_action: decision.next_action ?? null,
  conversation_move: decision.conversation_move ?? null,
  confidence: decision.confidence ?? null,
  tasks: (interpretation.tasks || []).map(task => ({
    route: task.route,
    requested_facts: task.requested_facts,
    needs_clarification: task.needs_clarification
  })),
  state_change_keys: (decision.state_changes || []).map(x => x.field ?? x.key ?? "unknown"),
  error_code: result.error_code ?? null,
  latency_ms: result.latency_ms ?? null,
  input_tokens: result.usage?.input_tokens ?? null,
  output_tokens: result.usage?.output_tokens ?? null,
  total_tokens: result.usage?.total_tokens ?? null,
  openai_calls: apiCalls
};

console.log("\n===== ACTUAL SEMANTIC TRACE =====");
console.log(JSON.stringify(actual, null, 2));

const allowedRoutes = ["page_question", "market_question"];

const pass = result.decision === "route" &&
  allowedRoutes.includes(actual.primary_route) &&
  actual.next_action === "KNOWLEDGE_QA" &&
  apiCalls === 1;

console.log("\n===== R04 ROUTING RESULT =====");
console.log("STATUS:", pass ? "PASS" : "FAIL");
console.log("SUPABASE CALLS: 0");
console.log("SOURCE FILES MODIFIED: 0");
console.log("DEPLOYS: 0");

process.exitCode = pass ? 0 : 1;
