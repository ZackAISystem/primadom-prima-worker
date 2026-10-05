import { buildPersonaInstructions } from "../src/persona-runtime.js";

const normal = buildPersonaInstructions({
  route: "recommendation",
  message: "Which project is better for my family?"
});

const founder = buildPersonaInstructions({
  route: "page_question",
  message: "Who created Prima?"
});

const plain = buildPersonaInstructions({
  route: "page_question",
  message: "What is the handover?"
});

if (!normal.includes("Honesty before conversion.")) {
  throw new Error("core_persona_missing");
}

if (!normal.includes("HANDOFF:")) {
  throw new Error("commercial_block_missing");
}

if (!founder.includes("Thredeesh Mannambeth Karyamkandy")) {
  throw new Error("founder_block_missing");
}

if (plain.includes("Thredeesh Mannambeth Karyamkandy")) {
  throw new Error("founder_block_loaded_unnecessarily");
}

if (plain.includes("HANDOFF:")) {
  throw new Error("commercial_block_loaded_unnecessarily");
}

console.log("PASS ✅ — Persona Runtime V1 selective blocks");
console.log("plain chars:", plain.length);
console.log("commercial chars:", normal.length);
console.log("founder chars:", founder.length);
