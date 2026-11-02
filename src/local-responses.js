import { resolveFollowUpReference } from "./follow-up.js";
import contract from "../contracts/prima-persona-v1.json" with { type: "json" };
import { classifyClearlyOffTopicRequest } from "./router.js";

// Fallback facts derive from the canonical approved Persona contract.
// A1 is the primary generator; this is only a safe local degradation path.
const founder=contract.founder;
const af=founder.approved_facts;
const PERSONA_FOUNDER_DETAILS = `${founder.name} is ${founder.title}. His experience includes ${af.dubai_real_estate_experience_years} years in Dubai real estate, ${af.emaar_experience_years} years at Emaar, ${af.transactions} transactions and ${af.property_sales_aed} in property sales. Those are his achievements, not Prima's.`;
const PERSONA_CREATOR_BRIEF = `Prima AI was developed by the Primadom team. ${founder.name} is its company's Founder & CEO, and his client-first philosophy helped shape the assistant. An exact launch date is not verified.`;
const PERSONA_IDENTITY_FALLBACK = `I'm Prima AI, the personal AI real estate assistant inside Primadom.ai. I help people research UAE property, compare options and make better-informed decisions.`;
const PERSONA_PLATFORM_FALLBACK = contract.brand.primadom_ai_user_facing;
const PERSONA_COMPANY_FALLBACK = `${contract.company_truth.primadom_real_estate} It developed Primadom.ai, an AI-powered UAE real estate intelligence platform.`;
const PERSONA_MISSION_FALLBACK = `Prima was developed by the Primadom team to help buyers make honest, data-informed and personalised UAE property decisions without sales pressure. Its exact creation date is not confirmed.`;


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
      `Availability at ${projectName} can change as units are reserved or released; a current check is needed.`
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
      `Current payment terms for ${projectName} should be confirmed against the latest project offer.`
    );
  }


  return null;
}


export function buildLocalRouteAnswer({
  route,
  message = "",
  personaIntent = null,
  knowledgePack = null,
  context = null
}) {
  const q =
    String(message)
      .trim()
      .toLowerCase();

  // These are property-fact fallbacks, not a second Persona router.
  // Never let a payment/availability phrase mask Persona or mixed intents.
  if (route === "exact_fact" || route === "page_question") {
    const criticalFactAnswer = buildCriticalFactGuard({
      message,
      knowledgePack,
      context
    });
    if (criticalFactAnswer) return criticalFactAnswer;
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

    const wantsOverview =
      /\b(?:tell me more|what can you tell me|give me an? overview)\b/i
        .test(
          String(
            message || ""
          )
        );

    if (wantsOverview) {
      return null;
    }

    const name =
      reference.name ||
      reference.slug ||
      "that option";

    // E1_8_SINGLE_PROJECT_FOLLOWUP_QUESTION_V1
    // Confirm the selection without asking a second
    // question before the existing project card and CTA.
    if (reference.type === "project") {
      const ordinalLabel =
        String(message || "")
          .match(
            /\b(?:the\s+)?(first|second|third)\s+(?:one|project|option)\b/i
          )?.[1]?.toLowerCase() || null;

      return ordinalLabel
        ? `The ${ordinalLabel} project is ${name}.`
        : `You're referring to ${name}.`;
    }


    if (reference.type === "district") {
      const ordinal = String(message || "").match(
        /\b(?:the\s+)?(first|second|third)\s+(?:one|developer|district|area|option)\b/i
      )?.[1]?.toLowerCase();

      return ordinal
        ? `The ${ordinal} district is ${name}.`
        : `You're referring to ${name}.`;
    }


    if (reference.type === "developer") {
      const ordinal = String(message || "").match(
        /\b(?:the\s+)?(first|second|third)\s+(?:one|developer|district|area|option)\b/i
      )?.[1]?.toLowerCase();

      return ordinal
        ? `The ${ordinal} developer is ${name}.`
        : `You're referring to ${name}.`;
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
      // Commercial invitations belong exclusively to the Funnel.
      // This neutral fallback must not offer advisor contact on its own.
      "I can still help you understand the buying process and the " +
      "questions to verify before making a decision."
    );
  }

  // PRIMA_GREETING_REGRESSION_FIX_V1
  if (
    route === "persona_question" &&
    /^(?:hi|hello|hey|good morning|good afternoon|good evening)(?:[\s,!.:-]+prima(?:\s+ai)?)?[\s!.,?👋]*$/iu.test(q)
  ) {
    return (
      "Hi! 👋 What would you like to explore in UAE real estate today?"
    );
  }

  if (route === "unsupported") {
    const kind = classifyClearlyOffTopicRequest(message);
    // A brief acknowledgement is enough for clear off-topic turns;
    // don't promote every unrelated question into a property sales pitch.
    if (kind === "weather") {
      return "I don't have a live weather forecast to verify current conditions. A weather service will give you a more reliable answer.";
    }
    if (kind === "cooking") {
      return "Cooking isn't my specialty — I focus on UAE real estate. A dedicated cooking guide would be more useful for recipes and techniques.";
    }
    if (kind === "personal_boundary") {
      return "I'm here as a UAE real estate assistant, not a romantic or intimate companion. We can return to property questions whenever you like.";
    }
    return "That's outside my UAE property specialty. I'm happy to help when you have a real estate question.";
  }

  if (route !== "persona_question") {
    return null;
  }

  // Local Persona is a SAFE FALLBACK, never the main conversational engine.
  // A1 runs before this module in index.js; it owns novel, multilingual,
  // multi-turn generative answers when enabled. Do not create question catalogs.
  // This fallback uses the semantic intent already chosen by Core/A1 where
  // available. Only a few unambiguous legacy core requests are recognized here.

  // Non-impersonation and investment claims are trust boundaries. These must
  // take precedence over unrelated semantic Persona labels on the fallback path.
  if (
    /\b(?:guarantee|guaranteed|promise)\b/i.test(q) &&
    /\b(?:profit|make money|investment|investing|roi|returns?|yield|appreciation|rental income)\b/i.test(q)
  ) {
    return "No. Neither Prima nor Primadom can guarantee investment profits, ROI, rental yield or future appreciation. I can help evaluate verified facts, risks and trade-offs instead.";
  }

  if (/\bare you (?:thredeesh|the founder)\b/i.test(q)) {
    return "No — I'm Prima, Primadom.ai's AI real estate advisor, not Primadom's founder.";
  }
  if (/\bare you (?:a )?(?:human|real person|broker)\b/i.test(q)) {
    return "No — I'm Prima, an AI real estate advisor on Primadom.ai, not a human broker.";
  }

  // Canonical intent labels belong to the semantic layer, not this file.
  // Approved founder facts are local only as failure-mode grounding; contract
  // consolidation with persona-runtime and A1 belongs to their later files.
  switch (personaIntent) {
    case "founder_career":
    case "founder_experience":
      return "Thredeesh has 16+ years of Dubai real estate experience, including 13+ years at Emaar. His record includes 2,500+ transactions and AED 4B+ in property sales. I don't have a verified position-by-position career timeline, so I won't invent one.";

    case "founder_relevance":
      return "His 16+ years in Dubai real estate, including 13+ at Emaar and 2,500+ transactions, give him extensive practical exposure to property decisions. That experience helped shape Prima's focus on evidence, tailored guidance and long-term client relationships; it doesn't guarantee investment outcomes.";

    case "founder_profile":
      return PERSONA_FOUNDER_DETAILS;

    case "prima_creator":
      return PERSONA_CREATOR_BRIEF;

    case "prima_identity":
      return PERSONA_IDENTITY_FALLBACK;

    case "primadom_platform":
      return PERSONA_PLATFORM_FALLBACK;

    case "primadom_company":
      return PERSONA_COMPANY_FALLBACK;

    case "persona_principles":
      return `My principles are honesty, verified data, client-first advice, long-term thinking, personalisation, market knowledge and support beyond the transaction.`;

    case "persona_capabilities":
      return "I can explain verified UAE property facts, help you research projects, developers and districts, compare options and narrow choices around your priorities. A Primadom specialist can help when you want human assistance.";

    case "persona_scope":
      return "I specialize in UAE real estate: projects, developers, districts, property searches, comparisons and property decisions based on your goals and budget.";

    case "ambiguous":
      break; // Use the actual message topic rather than forcing a clarification.
  }

  // Legacy zero-model fallback for a few explicitly unambiguous subjects.
  // This is not a parallel semantic router; unknown paraphrases go to A1,
  // or receive an honest clarification if generation is unavailable.
  if (/^(?:who are you|what are you|what is prima(?: ai)?|who is prima(?: ai)?)\s*[?.!]*$/i.test(q)) {
    return PERSONA_IDENTITY_FALLBACK;
  }

  if (/^(?:what is|what's)\s+primadom\.ai\s*[?.!]*$/i.test(q)) {
    return PERSONA_PLATFORM_FALLBACK;
  }

  if (/^(?:who (?:created|built|made) (?:you|prima(?: ai)?)|who is (?:the )?creator of prima(?: ai)?)\s*[?.!]*$/i.test(q)) {
    return PERSONA_CREATOR_BRIEF;
  }

  // On an A1 failure, give a truthful topical fallback rather than a generic
  // platform definition. These few verified boundaries are not the main answer engine.
  if (/\b(?:inspir(?:ed|ation|e)?|why.*(?:creat|develop)|vision behind)\b/i.test(q) &&
      /\b(?:founder|thredeesh|prima)\b/i.test(q)) {
    return founder.vision_for_prima_v1;
  }
  if (/\b(?:after[- ]sales|post[- ]purchase|after (?:the |a )?(?:sale|purchase)|after someone buys)\b/i.test(q)) {
    return contract.company_truth.after_sales_philosophy_v1;
  }
  if (/\b(?:knowledge|sources?|information)\b/i.test(q) &&
      /\b(?:where|come from|basing|based on|rely on)\b/i.test(q)) {
    return contract.brand.knowledge_network_v1.client_value_v1 + " I use relevant available verified facts, not necessarily live data.";
  }
  // On a paid A1 failure, still answer the identifiable topic safely.
  const priorTurns=Array.isArray(context?.conversation?.recent_messages)
    ? context.conversation.recent_messages.slice(-3).map(m=>String(m?.content||"")).join(" ") : "";
  if (/\b(?:he|him|his)\b/i.test(q) &&
      /\b(?:thredeesh|founder|emaar)\b/i.test(priorTurns))
    return PERSONA_FOUNDER_DETAILS;
  // These broad subject cues are not a catalogue of responses to questions.
  if (/\b(?:thredeesh|mannambeth|founder|emaar|his career|his experience)\b/i.test(q))
    return PERSONA_FOUNDER_DETAILS;
  if (/\b(?:primadom\.ai|platform|knowledge (?:base|network))\b/i.test(q))
    return PERSONA_PLATFORM_FALLBACK;
  if (/\b(?:primadom|company|agency)\b/i.test(q))
    return PERSONA_COMPANY_FALLBACK;
  if (/\b(?:why|mission|purpose|created|origin|developed)\b/i.test(q))
    return PERSONA_MISSION_FALLBACK;
  if (/\b(?:principles|values|ethics|philosophy)\b/i.test(q))
    return "I follow seven principles: honesty, evidence, client-first decisions, long-term thinking, personalisation, market knowledge and support beyond the transaction.";
  if (/\b(?:capabilities|help|can you do|expertise|market)\b/i.test(q))
    return "I can help you research UAE property projects, developers, districts and buyer scenarios, compare options and assess risks using verified information. Live data needs separate verification.";
  if (/\b(?:prima|you|your)\b/i.test(q)) return PERSONA_IDENTITY_FALLBACK;
  return "I can explain Prima AI and the Primadom real estate platform, including their purpose and the team behind them.";
}
