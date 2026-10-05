import {
  buildKnowledgePlan
} from "../src/knowledge-planner.js";


function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}


const passoContext = {
  page: {
    page_id: "page_project_passo_en",
    page_type: "project_page",
    language_code: "en",
    url_path: "/en/projects/passo/"
  },
  entity: {
    primary_type: "project",
    primary_slug: "passo"
  }
};


const tests = [
  {
    name: "exact fact",
    route: "exact_fact",
    message: "When is Passo handover?",
    context: passoContext,
    check(plan) {
      assert(
        plan.needs.includes(
          "current_entity.exact_fact"
        ),
        "exact_fact need missing"
      );

      assert(
        plan.reasoning_required === false,
        "exact_fact must not require reasoning"
      );
    }
  },

  {
    name: "family page question",
    route: "page_question",
    message:
      "Is this project good for a family with two children?",
    context: passoContext,
    check(plan) {
      assert(
        plan.topics.includes(
          "family_living"
        ),
        "family topic missing"
      );

      assert(
        plan.needs.includes(
          "current_entity.buyer_fit"
        ),
        "buyer fit missing"
      );

      assert(
        plan.needs.includes(
          "knowledge.buyer_scenario"
        ),
        "buyer scenario missing"
      );

      assert(
        plan.needs.includes(
          "related.district"
        ),
        "district relation missing"
      );
    }
  },

  {
    name: "risk page question",
    route: "page_question",
    message:
      "What are the main risks and trade-offs?",
    context: passoContext,
    check(plan) {
      assert(
        plan.topics.includes("risk"),
        "risk topic missing"
      );

      assert(
        plan.needs.includes(
          "current_entity.risks"
        ),
        "risk knowledge missing"
      );
    }
  },

  {
    name: "comparison",
    route: "compare",
    message:
      "Compare Passo vs Orla for investment",
    context: passoContext,
    check(plan) {
      assert(
        plan.needs.includes(
          "comparison.entities"
        ),
        "comparison entities missing"
      );

      assert(
        plan.topics.includes(
          "investment"
        ),
        "investment topic missing"
      );

      assert(
        plan.reasoning_required === true,
        "comparison must require reasoning"
      );
    }
  },

  {
    name: "recommendation",
    route: "recommendation",
    message:
      "What would you suggest for a family with AED 5M?",
    context: {
      page: {
        page_type: "homepage",
        language_code: "en",
        url_path: "/en/"
      },
      entity: {}
    },
    check(plan) {
      assert(
        plan.needs.includes(
          "knowledge.buyer_scenario"
        ),
        "recommendation buyer scenario missing"
      );

      assert(
        plan.needs.includes(
          "knowledge.budget"
        ),
        "recommendation budget missing"
      );

      assert(
        plan.include_market_context === true,
        "recommendation market context missing"
      );
    }
  }
];


for (const test of tests) {
  const plan =
    buildKnowledgePlan({
      route: test.route,
      message: test.message,
      context: test.context
    });

  test.check(plan);

  console.log(
    `PASS ✅ ${test.name}`
  );

  console.log(
    JSON.stringify(
      {
        route: plan.route,
        domain: plan.domain,
        topics: plan.topics,
        needs: plan.needs
      },
      null,
      2
    )
  );
}

console.log("");
console.log(
  "DAY 2 / KNOWLEDGE PLANNER V1 = PASS ✅"
);
