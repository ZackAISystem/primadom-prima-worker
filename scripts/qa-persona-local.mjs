import { routeIntent } from "../src/router.js";
import { buildLocalRouteAnswer } from "../src/local-responses.js";

function check(name, condition) {
  if (!condition) {
    throw new Error(name);
  }
}

const context = {
  entity: {
    primary_type: "project",
    primary_slug: "passo"
  }
};

const identity = buildLocalRouteAnswer({
  route: "persona_question",
  message: "Who are you?",
  context
});

const company = buildLocalRouteAnswer({
  route: "persona_question",
  message: "What is Primadom.ai?",
  context
});

const founder = buildLocalRouteAnswer({
  route: "persona_question",
  message: "Who created you?",
  context
});

const payment = buildLocalRouteAnswer({
  route: "page_question",
  message: "What is the payment plan?",
  knowledgePack: null,
  context
});

const availability = buildLocalRouteAnswer({
  route: "page_question",
  message: "Is it available now?",
  knowledgePack: null,
  context
});

const market = buildLocalRouteAnswer({
  route: "market_question",
  message: "How is Dubai market performing now?",
  context
});

const offTopic = buildLocalRouteAnswer({
  route: "unsupported",
  message: "Tell me a joke",
  context
});

check(
  "identity_wrong",
  identity.includes("I'm Prima") && identity.includes("AI real estate advisor") && identity.includes("UAE market")
);

check(
  "company_wrong",
  company.includes("AI-native UAE real estate intelligence platform")
);

check(
  "founder_wrong",
  founder.includes("Thredeesh Mannambeth Karyamkandy")
);

check(
  "payment_handoff_missing",
  payment.includes("payment terms") && payment.includes("confirmed")
);

check(
  "availability_handoff_missing",
  availability.includes("Availability at") && availability.includes("current check is needed")
);

check(
  "market_handoff_missing",
  market.includes("Primadom specialist")
);

check(
  "offtopic_not_human",
  offTopic.includes("outside my area") &&
  !offTopic.includes("Unsupported")
);

check(
  "primadom_route_failed",
  routeIntent("What is Primadom.ai?", {}) === "persona_question"
);

check(
  "offtopic_route_failed",
  routeIntent("Tell me a joke", {}) === "unsupported"
);

console.log("PASS ✅ — Persona local responses V1");
console.log("");
console.log("IDENTITY:", identity);
console.log("PRIMADOM:", company);
console.log("FOUNDER:", founder);
console.log("PAYMENT:", payment);
console.log("AVAILABILITY:", availability);
console.log("MARKET:", market);
console.log("OFF-TOPIC:", offTopic);
