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
      "Availability can change, so I won't present static project data as live inventory."
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
      `I don't have a verified payment plan for ${projectName} in the available Primadom data. ` +
      "I won't infer one from the price, status or handover information."
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
      "I don't have a verified live market dataset connected " +
      "for current Dubai-wide market performance yet, so I won't " +
      "invent transaction, demand, price-trend or rental figures. " +
      "I can still help with verified Primadom knowledge about " +
      "specific projects, developers, districts and buying decisions."
    );
  }

  if (route === "unsupported") {
    return (
      "I'm focused on UAE real estate and Primadom-related questions. " +
      "I can help with projects, areas, developers, comparisons, budgets, " +
      "buyer fit, property search and UAE real-estate market questions."
    );
  }

  if (route !== "persona_question") {
    return null;
  }

  if (
    /\b(who created you|who built you|who made you|creator|founder|thredeesh)\b/i
      .test(q)
  ) {
    return (
      "Prima AI was created for Primadom Real Estate under the direction of " +
      "Thredeesh Mannambeth Karyamkandy, Founder & CEO of Primadom Real Estate. " +
      "My role is to help people make clearer UAE real-estate decisions using " +
      "Primadom data, knowledge and AI."
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
    "I'm Prima, Primadom Real Estate's UAE real-estate AI assistant. " +
    "I use Primadom knowledge, structured property data and AI reasoning when " +
    "needed to help you evaluate projects, areas and buying decisions."
  );
}
