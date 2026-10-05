import {
  extractMemoryFacts,
  isContextualNameCandidate,
  isExpectingNameFromRecentMessages
} from "../src/memory.js";

function factsMap(message, options = {}) {
  return Object.fromEntries(
    extractMemoryFacts(message, options)
      .map(item => [
        item.fact_key,
        item.fact_value
      ])
  );
}

function check(name, condition) {
  if (!condition) {
    throw new Error(name);
  }
}

/*
  1. Bare name is only a candidate.
*/
check(
  "zack_not_candidate",
  isContextualNameCandidate("Zack") === true
);

check(
  "john_smith_not_candidate",
  isContextualNameCandidate("John Smith") === true
);

/*
  2. Known non-name short replies remain blocked.
*/
for (const value of [
  "Passo",
  "Dubai",
  "Investment"
]) {
  check(
    `blocked_candidate_${value}`,
    isContextualNameCandidate(value) === false
  );
}

/*
  3. Prima actually asked for the name.
*/
const askedName = [
  {
    role: "assistant",
    content:
      "Hi, I’m Prima 👋 I’m an AI real estate advisor focused on the UAE market. What’s your name?"
  }
];

check(
  "expecting_name_not_detected",
  isExpectingNameFromRecentMessages(
    askedName
  ) === true
);

/*
  4. Ordinary assistant turn must not activate name capture.
*/
const didNotAskName = [
  {
    role: "assistant",
    content:
      "Passo is an off-plan project with a recorded handover in December 2029."
  }
];

check(
  "false_expecting_name",
  isExpectingNameFromRecentMessages(
    didNotAskName
  ) === false
);

/*
  5. Bare Zack is captured only with contextual permission.
*/
const withoutContext =
  factsMap("Zack");

check(
  "bare_name_captured_without_context",
  !Object.prototype.hasOwnProperty.call(
    withoutContext,
    "user_name"
  )
);

const withContext =
  factsMap(
    "Zack",
    {
      expectingName: true
    }
  );

check(
  "contextual_name_not_captured",
  withContext.user_name === "Zack"
);

/*
  6. Explicit name still works without context.
*/
const explicit =
  factsMap(
    "My name is Zack"
  );

check(
  "explicit_name_regression",
  explicit.user_name === "Zack"
);

/*
  7. Blocked terms must not become names
  even when Prima previously asked.
*/
for (const value of [
  "Passo",
  "Dubai",
  "Investment"
]) {
  const result =
    factsMap(
      value,
      {
        expectingName: true
      }
    );

  check(
    `blocked_name_${value}`,
    !Object.prototype.hasOwnProperty.call(
      result,
      "user_name"
    )
  );
}

console.log(
  "PASS ✅ — contextual name memory"
);

console.log(
  "Prima asks name → Zack → user_name=Zack ✅"
);

console.log(
  "Zack without name question → no user_name ✅"
);

console.log(
  "Passo / Dubai / Investment → no user_name ✅"
);
