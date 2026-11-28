import { resolveFollowUpReference } from "../../../follow-up.js";
import contract from "../contracts/prima-persona-v1.json" with { type: "json" };
import { classifyClearlyOffTopicRequest } from "./router.js";

// Fallback facts derive from the canonical approved Persona contract.
// A1 is the primary generator; this is only a safe local degradation path.
const founder=contract.founder;
const af=founder.approved_facts;
const PERSONA_FOUNDER_DETAILS = `${founder.name} — ${founder.title}. Его опыт включает ${af.dubai_real_estate_experience_years} лет в недвижимости Дубая, ${af.emaar_experience_years} лет в Emaar, ${af.transactions} сделок и ${af.property_sales_aed} продаж.`;
const PERSONA_CREATOR_BRIEF = `Prima AI разработана командой Primadom. ${founder.name} — основатель и CEO компании; его ориентация на интересы клиента повлияла на принципы помощника. Точная дата запуска не подтверждена.`;
const PERSONA_IDENTITY_FALLBACK = `Я Prima AI — персональный AI-консультант по недвижимости внутри Primadom.ai. Помогаю исследовать рынок ОАЭ, сравнивать варианты и принимать более обоснованные решения.`;
const PERSONA_PLATFORM_FALLBACK = contract.brand.primadom_ai_user_facing;
const PERSONA_COMPANY_FALLBACK = `${contract.company_truth.primadom_real_estate} Компания разработала Primadom.ai — AI-платформу анализа недвижимости ОАЭ.`;
const PERSONA_MISSION_FALLBACK = `Prima разработана командой Primadom, чтобы помогать покупателям принимать честные, основанные на данных и персонализированные решения о недвижимости ОАЭ без коммерческого давления. Точная дата создания не подтверждена.`;


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
    : "этот проект";
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
      `Наличие квартир в ${projectName} может меняться по мере бронирований и новых поступлений. Требуется актуальная проверка.`
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
        `Указанный в данных план оплаты для ${projectName} — ${value}.`
      );
    }

    return (
      `Текущие условия оплаты по ${projectName} нужно подтвердить по актуальному предложению проекта.`
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
          `Я нашла ${candidates.length} проектов по запросу ` +
          `«${comparison?.target_query || "это название"}»: ` +
          `${candidates.join(" и ")}. ` +
          "Какой из них вы хотите сравнить?"
        );
      }

      return (
        "Я нашла несколько подходящих проектов. " +
        "Какой из них вы хотите сравнить?"
      );
    }

    if (
      status ===
      "other_not_found" ||
      status ===
      "other_page_not_found"
    ) {
      return (
        "Не удалось надёжно определить второй проект " +
        "в подтверждённых данных Primadom. " +
        "Напишите, пожалуйста, его полное название."
      );
    }

    if (
      status ===
      "target_missing"
    ) {
      return (
        "С каким проектом вы хотите сравнить " +
        "текущий?"
      );
    }

    if (
      status ===
      "current_not_found"
    ) {
      return (
        "Мне не удалось с достаточной точностью определить текущий проект " +
        "для сравнения."
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
        "Хочу быть уверена, что правильно понимаю, о каком объекте или районе речь. " +
        "Что именно вы имели в виду?"
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
        ? `Проект ${ordinalLabel} — ${name}.`
        : `Вы имеете в виду ${name}.`;
    }


    if (reference.type === "district") {
      const ordinal = String(message || "").match(
        /\b(?:the\s+)?(first|second|third)\s+(?:one|developer|district|area|option)\b/i
      )?.[1]?.toLowerCase();

      return ordinal
        ? `Район ${ordinal} — ${name}.`
        : `Вы имеете в виду ${name}.`;
    }


    if (reference.type === "developer") {
      const ordinal = String(message || "").match(
        /\b(?:the\s+)?(first|second|third)\s+(?:one|developer|district|area|option)\b/i
      )?.[1]?.toLowerCase();

      return ordinal
        ? `Застройщик ${ordinal} — ${name}.`
        : `Вы имеете в виду ${name}.`;
    }

    return (
      `Вы имеете в виду ${name}. ` +
      "Что вы хотите о нём уточнить?"
    );
  }


  if (route === "market_question") {
    return (
      "Сейчас у меня нет подтверждённых актуальных данных по рынку Дубая в целом, " +
      "поэтому не буду угадывать объёмы сделок, спрос, динамику цен или аренды. " +
      // Commercial invitations belong exclusively to the Funnel.
      // This neutral fallback must not offer advisor contact on its own.
      "Но я могу помочь разобраться в процессе покупки и в том, " +
      "какие сведения нужно проверить перед решением."
    );
  }

  // PRIMA_GREETING_REGRESSION_FIX_V1
  if (
    route === "persona_question" &&
    /^(?:hi|hello|hey|good morning|good afternoon|good evening)(?:[\s,!.:-]+prima(?:\s+ai)?)?[\s!.,?👋]*$/iu.test(q)
  ) {
    return (
      "Привет! 👋 Что вас интересует в недвижимости ОАЭ?"
    );
  }

  if (route === "unsupported") {
    const kind = classifyClearlyOffTopicRequest(message);
    // A brief acknowledgement is enough for clear off-topic turns;
    // don't promote every unrelated question into a property sales pitch.
    if (kind === "weather") {
      return "У меня нет возможности подтвердить актуальный прогноз погоды. Надёжнее проверить его в погодном сервисе.";
    }
    if (kind === "cooking") {
      return "Кулинария не моя специализация — я помогаю с недвижимостью ОАЭ. Для рецептов лучше обратиться к специализированному источнику.";
    }
    if (kind === "personal_boundary") {
      return "Я AI-консультант по недвижимости ОАЭ, а не романтический собеседник. Если захотите, вернёмся к вопросам недвижимости.";
    }
    return "Это за пределами моей специализации по недвижимости ОАЭ. Буду рада помочь с вопросами о рынке.";
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
    return "Нет. Ни Prima, ни Primadom не гарантируют инвестиционную прибыль, ROI, арендную доходность или рост стоимости. Я могу помочь сопоставить подтверждённые факты, риски и компромиссы.";
  }

  if (/\bare you (?:thredeesh|the founder)\b/i.test(q)) {
    return "Нет. Я Prima, AI-консультант Primadom.ai по недвижимости, а не основатель Primadom.";
  }
  if (/\bare you (?:a )?(?:human|real person|broker)\b/i.test(q)) {
    return "Нет. Я Prima, AI-консультант по недвижимости на Primadom.ai, а не риелтор-человек.";
  }

  // Canonical intent labels belong to the semantic layer, not this file.
  // Approved founder facts are local only as failure-mode grounding; contract
  // consolidation with persona-runtime and A1 belongs to their later files.
  switch (personaIntent) {
    case "founder_career":
    case "founder_experience":
      return "Thredeesh имеет более 16 лет опыта в недвижимости Дубая, включая более 13 лет работы в Emaar. По утверждённым данным, за ним более 2 500 сделок и свыше AED 4 млрд продаж недвижимости.";

    case "founder_relevance":
      return "Его более чем 16-летний опыт в недвижимости Дубая, включая свыше 13 лет в Emaar и более 2 500 сделок, даёт широкое практическое понимание рынка. Этот опыт отражён в принципах Prima, но не заменяет проверку фактов.";

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
      return `Мои принципы — честность, проверенные данные, интересы клиента, долгосрочный подход, персонализация, знание рынка и поддержка после сделки.`;

    case "persona_capabilities":
      return "Я могу объяснить подтверждённые сведения о недвижимости ОАЭ, помочь изучить проекты, девелоперов и районы, сравнить варианты и сузить выбор по вашим приоритетам. Специалист Primadom может проверить актуальные условия.";

    case "persona_scope":
      return "Я специализируюсь на недвижимости ОАЭ: проектах, застройщиках, районах, поиске, сравнении и выборе объектов с учётом ваших целей и бюджета.";

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
    return contract.brand.knowledge_network_v1.client_value_v1 + " Я использую доступные подтверждённые данные, которые не обязательно являются актуальными в реальном времени.";
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
    return "Я следую семи принципам: честность, опора на доказательства, приоритет клиента, долгосрочное мышление, персонализация, знание рынка и поддержка после сделки.";
  if (/\b(?:capabilities|help|can you do|expertise|market)\b/i.test(q))
    return "Могу помочь изучить проекты, застройщиков, районы и сценарии покупки недвижимости ОАЭ, сравнить варианты и оценить риски по проверенным данным. Актуальную доступность нужно подтверждать отдельно.";
  if (/\b(?:prima|you|your)\b/i.test(q)) return PERSONA_IDENTITY_FALLBACK;
  return "Могу рассказать о Prima AI и платформе Primadom, их задачах и команде создателей.";
}
