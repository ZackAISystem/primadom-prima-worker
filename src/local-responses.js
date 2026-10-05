import { resolveFollowUpReference } from "./follow-up.js";


function humanizeSlug(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map(
      part =>
        part.charAt(0).toUpperCase() +
        part.slice(1)
    )
    .join(" ");
}


function getProjectName(
  knowledgePack,
  context = null
) {
  const slug =
    knowledgePack
      ?.page
      ?.primary_entity_slug ||
    context
      ?.entity
      ?.primary_slug ||
    null;

  return slug
    ? humanizeSlug(slug)
    : "this project";
}


function getKeyFactValue(
  knowledgePack,
  keys = []
) {
  const block =
    (
      knowledgePack?.blocks || []
    ).find(
      item =>
        item?.block_family ===
        "key_facts"
    );

  const facts =
    block
      ?.final_block_json
      ?.key_facts;

  if (!Array.isArray(facts)) {
    return null;
  }

  const wanted =
    new Set(
      keys.map(
        key =>
          String(key)
            .trim()
            .toLowerCase()
      )
    );

  const fact =
    facts.find(
      item =>
        wanted.has(
          String(item?.key || "")
            .trim()
            .toLowerCase()
        )
    );

  const value =
    fact?.value;

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  const text =
    String(value).trim();

  if (
    !text ||
    text === "—" ||
    /^(n\/a|na|null|unknown|tbc|tbd)$/i
      .test(text)
  ) {
    return null;
  }

  return text;
}


function buildCriticalFactGuard({
  message,
  knowledgePack,
  context = null
}) {
  const q =
    String(message || "")
      .trim()
      .toLowerCase();

  const projectName =
    getProjectName(
      knowledgePack,
      context
    );


  // -------------------------------------------------------
  // LIVE AVAILABILITY
  // Static project content must never be represented
  // as live inventory.
  // -------------------------------------------------------

  if (
    /\b(availability|available right now|available now|units? available|live inventory|inventory now)\b/i
      .test(q)
  ) {
    return (
      `I don't have verified live availability for ${projectName} right now. ` +
      "If you'd like, I can ask a Primadom specialist to check the latest availability for you."
    );
  }


  // -------------------------------------------------------
  // PAYMENT PLAN
  // Return only an explicitly stored verified fact.
  // Never substitute price/status/handover.
  // -------------------------------------------------------

  if (
    /\b(payment plan|payment schedule|installment plan|instalment plan|installments|instalments)\b/i
      .test(q)
  ) {
    const value =
      getKeyFactValue(
        knowledgePack,
        [
          "payment_plan",
          "payment_plan_summary",
          "payment_schedule"
        ]
      );

    if (value) {
      return (
        `The recorded payment plan for ${projectName} is ${value}.`
      );
    }

    return (
      `I don't have a verified payment plan for ${projectName} right now. ` +
      "If you'd like, I can ask a Primadom specialist to check the latest terms for you."
    );
  }


  return null;
}


export function buildLocalRouteAnswer({
  route,
  message = "",
  knowledgePack = null,
  context = null
}) {
  const q =
    String(message)
      .trim()
      .toLowerCase();

  const criticalFactAnswer =
    buildCriticalFactGuard({
      message,
      knowledgePack,
      context
    });

  if (criticalFactAnswer) {
    return criticalFactAnswer;
  }


  if (route === "compare") {
    const comparison =
      knowledgePack
        ?.related_knowledge
        ?.comparison ||
      null;

    const status =
      comparison?.status ||
      null;

    if (
      status ===
      "ambiguous"
    ) {
      const candidates =
        (
          comparison
            ?.candidates ||
          []
        )
          .map(
            item =>
              item?.project_name
          )
          .filter(Boolean);

      if (candidates.length) {
        return (
          `I found ${candidates.length} projects matching ` +
          `"${comparison?.target_query || "that name"}": ` +
          `${candidates.join(" and ")}. ` +
          "Which one would you like me to compare?"
        );
      }

      return (
        "I found more than one matching project. " +
        "Which one would you like me to compare?"
      );
    }

    if (
      status ===
      "other_not_found" ||
      status ===
      "other_page_not_found"
    ) {
      return (
        "I couldn't confidently identify the second project " +
        "in Primadom's verified project data. " +
        "Please give me its full project name."
      );
    }

    if (
      status ===
      "target_missing"
    ) {
      return (
        "Which project would you like me to compare " +
        "with the current one?"
      );
    }

    if (
      status ===
      "current_not_found"
    ) {
      return (
        "I couldn't resolve the current project reliably " +
        "enough to compare it."
      );
    }
  }


  if (route === "follow_up") {
    const reference =
      resolveFollowUpReference({
        message,
        context
      });

    if (!reference?.resolved) {
      return (
        "I want to make sure I follow the right property or area. " +
        "Which one do you mean?"
      );
    }

    const name =
      reference.name ||
      reference.slug ||
      "that option";

    if (reference.type === "project") {
      return (
        `You're referring to ${name}. ` +
        "What would you like me to check about it — " +
        "price, handover, location, buyer fit or something else?"
      );
    }

    if (reference.type === "district") {
      return (
        `You're referring to ${name}. ` +
        "What would you like to know about the area?"
      );
    }

    if (reference.type === "developer") {
      return (
        `You're referring to ${name}. ` +
        "What would you like to know about the developer?"
      );
    }

    return (
      `You're referring to ${name}. ` +
      "What would you like me to check about it?"
    );
  }


  if (route === "market_question") {
    return (
      "I don't have verified live Dubai-wide market figures connected right now, " +
      "so I won't guess current transaction, demand, price-trend or rental data. " +
      "I can still help with verified Primadom knowledge, or connect you with a " +
      "Primadom specialist if you need a current market check."
    );
  }

  if (route === "unsupported") {
    return (
      "That's a little outside my area 😄 I'm much more useful when it comes to UAE real estate. " +
      "I can help with projects, areas, developers, comparisons, budgets or finding the right property for you."
    );
  }

  if (route !== "persona_question") {
    return null;
  }

  if (
    /\b(what is primadom|what's primadom|what is primadom\.ai|about primadom|about primadom\.ai)\b/i
      .test(q)
  ) {
    return (
      "Primadom.ai is an AI-native UAE real estate intelligence platform combining " +
      "market knowledge, intelligent search and Prima AI to help buyers and investors " +
      "understand the market and make better property decisions."
    );
  }

  if (
    /\b(who created you|who built you|who made you|creator|founder|thredeesh)\b/i
      .test(q)
  ) {
    return (
      "Prima AI was created under the direction of Thredeesh Mannambeth Karyamkandy, " +
      "Founder & CEO of Primadom Real Estate. His experience and principles around " +
      "honesty, data and personalised advice helped shape how I'm designed to work."
    );
  }

  if (
    /\b(values|principles|how do you work|how do you make decisions|your approach)\b/i
      .test(q)
  ) {
    return (
      "My core principles are honesty first, data over opinion, client goals " +
      "above everything and long-term thinking. I aim to be precise, useful " +
      "and commercially aware without being pushy."
    );
  }

  if (
    /\b(what can you do|what can you help|how can you help|your capabilities)\b/i
      .test(q)
  ) {
    return (
      "I can answer questions about UAE projects, developers and areas, compare " +
      "options, explain verified project facts, help narrow choices to your " +
      "budget and goals, discuss market questions and help you connect with a " +
      "Primadom advisor when useful."
    );
  }

  return (
    "I'm Prima, an AI real estate advisor focused on the UAE market. " +
    "I help buyers and investors understand their options, compare properties " +
    "and make more confident property decisions."
  );
}
