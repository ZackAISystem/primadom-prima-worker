import { extractMemoryFacts } from "../src/memory.js";

function mapFacts(text, options = {}) {
  return Object.fromEntries(
    extractMemoryFacts(text, options)
      .map(item => [
        item.fact_key,
        item.fact_value
      ])
  );
}

function assertEqual(name, actual, expected) {
  if (
    JSON.stringify(actual) !==
    JSON.stringify(expected)
  ) {
    throw new Error(
      `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertMissing(name, object, key) {
  if (Object.prototype.hasOwnProperty.call(object, key)) {
    throw new Error(
      `${name}: unexpected ${key}=${JSON.stringify(object[key])}`
    );
  }
}

const nameExplicit =
  mapFacts("My name is Zack");

assertEqual(
  "explicit_name",
  nameExplicit.user_name,
  "Zack"
);

const nameExpected =
  mapFacts(
    "Zack",
    { expectingName: true }
  );

assertEqual(
  "expected_bare_name",
  nameExpected.user_name,
  "Zack"
);

const nameUnsafe =
  mapFacts("Passo");

assertMissing(
  "bare_project_not_name",
  nameUnsafe,
  "user_name"
);

const profile =
  mapFacts(
    "I'm looking for a 2 bedroom apartment in Dubai Hills. My budget is between AED 4m and 6m. I have two children and I'm buying it for investment with a mortgage."
  );

assertEqual(
  "budget_min",
  profile.budget_min_aed,
  4000000
);

assertEqual(
  "budget_max",
  profile.budget_max_aed,
  6000000
);

assertEqual(
  "bedrooms",
  profile.bedrooms,
  2
);

assertEqual(
  "property_type",
  profile.property_type,
  "apartment"
);

assertEqual(
  "location",
  profile.preferred_location_text,
  "Dubai Hills"
);

assertEqual(
  "children",
  profile.children_count,
  2
);

assertEqual(
  "goal",
  profile.buyer_goal,
  "investment"
);

assertEqual(
  "financing",
  profile.financing,
  "mortgage"
);

const personal =
  mapFacts(
    "I live in London. I work in technology. I'm relocating to Dubai. I prefer something quiet, private and waterfront."
  );

assertEqual(
  "residence",
  personal.residence_location_text,
  "London"
);

assertEqual(
  "business_sector",
  personal.business_sector_text,
  "technology"
);

assertEqual(
  "relocation",
  personal.relocation_destination_text,
  "Dubai"
);

assertEqual(
  "lifestyle",
  personal.lifestyle_preferences,
  ["waterfront", "quiet", "privacy"]
);

const timeline =
  mapFacts(
    "I'm planning to buy within 6 months and my investment horizon is 5 years."
  );

assertEqual(
  "purchase_timeline",
  timeline.purchase_timeline_text,
  "within 6 months"
);

assertEqual(
  "investment_horizon",
  timeline.investment_horizon_text,
  "5 years"
);

const noFalseBedrooms =
  mapFacts(
    "Does Passo have 2 bedroom apartments?"
  );

assertMissing(
  "generic_bedroom_question",
  noFalseBedrooms,
  "bedrooms"
);

const noFalseGoal =
  mapFacts(
    "Is this project good for investment?"
  );

assertMissing(
  "generic_investment_question",
  noFalseGoal,
  "buyer_goal"
);

const noFalseMortgage =
  mapFacts(
    "What are the mortgage rates?"
  );

assertMissing(
  "generic_mortgage_question",
  noFalseMortgage,
  "financing"
);

const noFalseLive =
  mapFacts(
    "Is there live availability?"
  );

assertMissing(
  "live_availability_not_personal_use",
  noFalseLive,
  "buyer_goal"
);

console.log("PASS ✅ — Memory V1 high-confidence extraction");
console.log("PROFILE:", JSON.stringify(profile));
console.log("PERSONAL:", JSON.stringify(personal));
console.log("TIMELINE:", JSON.stringify(timeline));
console.log("FALSE POSITIVE GUARDS: PASS ✅");
