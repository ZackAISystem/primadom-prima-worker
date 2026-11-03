import { normalizePreferredLocationTextV1 } from "./preferred-location-v1.js";
const numberWords = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

function parseCompactNumber(raw) {
  if (!raw) return null;

  const cleaned = String(raw)
    .toLowerCase()
    .replace(/,/g, "")
    .trim();

  const match =
    cleaned.match(
      /^(\d+(?:\.\d+)?)\s*([mk])?$/i
    );

  if (!match) return null;

  let value = Number(match[1]);

  if (match[2] === "m") value *= 1000000;
  if (match[2] === "k") value *= 1000;

  return Math.round(value);
}

function cleanTextValue(
  value,
  maxLength = 100
) {
  if (!value) return null;

  const cleaned =
    String(value)
      .trim()
      .replace(
        /^[,.;:!? ]+|[,.;:!? ]+$/g,
        ""
      )
      .replace(/\s+/g, " ")
      .slice(0, maxLength)
      .trim();

  return cleaned || null;
}

function normalizePreferredName(
  value
) {
  const cleaned =
    cleanTextValue(
      value,
      40
    );

  if (!cleaned) {
    return null;
  }

  /*
    Preserve intentional casing:
    AJ, McKay, Dany.

    If all alphabetic characters were entered
    lowercase, normalize each name part.
  */
  const letters =
    cleaned.replace(
      /[^A-Za-z]/g,
      ""
    );

  if (
    !letters ||
    letters !==
      letters.toLowerCase()
  ) {
    return cleaned;
  }

  return cleaned.replace(
    /(^|[\s'-])([a-z])/g,
    (
      _match,
      separator,
      letter
    ) =>
      separator +
      letter.toUpperCase()
  );
}


function setFact(
  facts,
  factKey,
  factValue,
  confidence
) {
  if (
    factValue === null ||
    factValue === undefined ||
    factValue === ""
  ) {
    return;
  }

  const index =
    facts.findIndex(
      item =>
        item.fact_key === factKey
    );

  const fact = {
    fact_key: factKey,
    fact_value: factValue,
    confidence
  };

  if (index >= 0) {
    facts[index] = fact;
  } else {
    facts.push(fact);
  }
}

function looksLikeBareName(
  value
) {
  const text =
    cleanTextValue(value, 40);

  if (!text) return false;

  if (
    !/^[A-Za-z][A-Za-z' -]{0,39}$/
      .test(text)
  ) {
    return false;
  }

  const lower =
    text.toLowerCase();

  const blocked =
    new Set([
      "dubai",
      "investment",
      "investor",
      "ready",
      "property",
      "project",
      "villa",
      "apartment",
      "mortgage",
      "cash",
      "yes",
      "no",
      "okay",
      "ok",
      "sure",
      "maybe",
      "later",
      "skip",
      "pass",
      "hello",
      "hi",
      "hey",
      "help",
      "whatever",
      "idk",
      "i dont know",
      "i don't know",
      "thanks",
      "thank you"
    ]);

  return !blocked.has(lower);
}

function looksLikeQuestionOrRequest(
  value = ""
) {
  const text =
    String(value)
      .trim()
      .toLowerCase();

  if (!text) {
    return false;
  }

  return (
    /\?$/.test(text) ||

    /^(what|who|where|when|why|how|which|whose)\b/
      .test(text) ||

    /^(can|could|would|will|do|does|did|is|are|was|were|should|may)\b/
      .test(text) ||

    /^(show|find|search|tell|give|help|compare|recommend|explain|list|check|look|open|invest|buy|sell)\b/
      .test(text)
  );
}


export function isContextualNameCandidate(
  message = ""
) {
  const text =
    String(message).trim();

  return (
    !looksLikeQuestionOrRequest(text) &&
    looksLikeBareName(text) &&
    text.split(/\s+/).length <= 3
  );
}

export function isNonNameOnboardingReply(
  message = ""
) {
  const normalized =
    String(message)
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/g, "")
      .replace(/\s+/g, " ");

  return new Set([
    "yes",
    "no",
    "okay",
    "ok",
    "sure",
    "maybe",
    "later",
    "skip",
    "pass",
    "hello",
    "hi",
    "hey",
    "help",
    "whatever",
    "idk",
    "i dont know",
    "i don't know",
    "thanks",
    "thank you"
  ]).has(normalized);
}


// MEM02: narrow, deterministic social greeting recognition.
// Intentionally anchored: a greeting prefacing Search/Contact must not
// swallow the substantive request. No model call is needed for this case.
export function isStandaloneGreeting(message = "") {
  const q = String(message || "").trim();
  if (!q || q.length > 130) return false;
  return /^(?:hi|hello|hey|hiya|greetings|good\s+morning|good\s+afternoon|good\s+evening|morning|afternoon|evening)(?:[\s,!.:—-]+there)?(?:[\s,!.:—-]+(?:prima(?:\s+ai)?|primadom(?:\.ai)?))?[\s,!.?👋]*(?:(?:how\s+are\s+you|how(?:['’]s|\s+is)\s+it\s+going|hope\s+you(?:['’]re|\s+are)\s+well)[.!?]*)?$/iu.test(q);
}

// Remove a greeting ONLY when immediately followed by an explicit
// self-introduction. Never trim a substantive Search/Contact request.
function stripIntroGreeting(message = "") {
  return String(message).trim().replace(
    /^(?:(?:hi|hello|hey|hiya|greetings|good\s+morning|good\s+afternoon|good\s+evening|morning|afternoon|evening)(?:[\s,!.:—-]+there)?(?:[\s,!.:—-]+(?:prima(?:\s+ai)?|primadom(?:\.ai)?))?)[\s,!:—.-]+(?=i(?:['’]?m|\s+am)\b|my\s+name\s+is\b|(?:(?:you\s+can|you\s+may)\s+)?call\s+me\b)/iu,
    ""
  ).trim();
}

// A-01: Memory integrity gate. A confidence score is not evidence of a name.
// Use the user's verbatim self-introduction; ambiguous identity/profile text
// must be interpreted semantically before persistence, not promoted by regex.
// This function validates candidates only: it does NOT manufacture a name.
export function isEvidenceBackedUserName(message = "", candidate = "", {
  expectingName = false
} = {}) {
  const name = cleanTextValue(candidate, 40);
  if (!name || !/^[A-Za-z][A-Za-z' -]{0,39}$/.test(name) ||
      name.split(/\s+/).length > 3) return false;
  // Coordinators / personal pronouns inside a candidate indicate an
  // incorrectly swallowed sentence, not an independently supplied name.
  if (/\b(?:and|but|because|i|we|you|my|your)\b/i.test(name)) return false;
  const raw = stripIntroGreeting(message);
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const explicit = new RegExp(
    `\\bmy\\s+name\\s+is\\s+${safe}(?=$|[,.!?;:—-]|\\s+(?:and|but|from)\\b)`, "i"
  );
  if (explicit.test(raw)) return true;

  // "Call me" is ambiguous with a request for a phone call. Without a
  // proper-name-shaped literal in the original text, require semantic
  // clarification; never save "Next Week" as a name.
  const call = new RegExp(
    `\\bcall\\s+me\\s+(${safe})(?=$|[,.!?;:—-]|\\s+(?:and|but|from|instead)\\b)`, "i"
  ).exec(raw);
  if (call && /^[A-Z]/.test(call[1])) return true;

  // "I'm Zack" / "I'm Zack, looking ..." can be local only when the
  // ORIGINAL proper-name token is capitalized and the grammar closes.
  // "I'm an investor" / "I'm worried about ROI" stay non-name facts.
  const intro = new RegExp(
    `^I(?:['’]?m|\\s+am)\\s+(${safe})(?=$|[,.!?;:—-]|\\s+(?:and\\s+(?:looking|searching|seeking|wanting|needing|planning)\\b|looking\\b|searching\\b|seeking\\b|wanting\\b|needing\\b|interested\\s+in\\b))`, "i"
  ).exec(raw);
  if (intro && /^[A-Z]/.test(intro[1]) &&
      intro[1].split(/\s+/).every(part => /^[A-Z]/.test(part))) return true;

  // An explicit conversational introduction is distinct from a statement
  // that a property "is" something; case plus exact name must match.
  const thisIs = new RegExp(
    `\\bthis\\s+is\\s+(${safe})(?=$|[,.!?;:—-])`, "i"
  ).exec(raw);
  if (thisIs && /^[A-Z]/.test(thisIs[1])) return true;

  // Prima has just asked for a name. Never infer identity from a free-form
  // reply unless the candidate is the entire reply or precedes a clear task.
  if (expectingName) {
    if (raw.toLowerCase() === name.toLowerCase()) return true;
    const contextual = new RegExp(
      `^(${safe})(?=\\s*[,;:—-]\\s*|\\s+(?:looking|searching|show|find|need|want)\\b)`, "i"
    ).exec(raw);
    if (contextual && /^[A-Z]/.test(contextual[1])) return true;
  }
  return false;
}

export function isExplicitNameOnlyMessage(
  message = ""
) {
  const text =
    stripIntroGreeting(message);

  // These are requests or profile statements, NOT terminal name turns.
  if (/\b(?:looking for|searching for|show me|find me|need an?\b|want an?\b|interested in|planning to|buying an?\b|seeking|compare|recommend|contact me|book an?\b)\b/i.test(text)) return false;

  // A name + Search/Compare remains a mixed request, not a local name turn.
  if (/\b(?:and|then)\s+(?:find|search|show|compare|recommend|contact|book|tell me|look for)\b/i.test(text)) return false;
  return (
    /^(?:(?:no|actually|sorry)\s*[,—-]?\s*)?(?:my name is|(?:(?:you can|you may)\s+)?call me)\s+(?!back\b|later\b|tomorrow\b|today\b|at\b|on\b|for\b|about\b)[A-Za-z][A-Za-z' -]{0,40}?(?:\s+(?:for (?:this|the) (?:conversation|chat)|instead of [A-Za-z][A-Za-z' -]{0,35}|from now on))?[.!]?$/i
      .test(text) ||
    /^I(?:['’]?m|\s+am)\s+[A-Za-z][A-Za-z' -]{0,40}[.!]?$/i
      .test(text)
  ) && extractMemoryFacts(message).some(fact => fact.fact_key === "user_name");
}


export function isExpectingNameFromRecentMessages(
  recentMessages = []
) {
  if (
    !Array.isArray(recentMessages) ||
    recentMessages.length === 0
  ) {
    return false;
  }

  const lastMessage =
    [...recentMessages]
      .reverse()
      .find(
        item =>
          String(
            item?.content || ""
          ).trim()
      );

  if (!lastMessage) {
    return false;
  }

  const role =
    String(
      lastMessage?.role || ""
    ).toLowerCase();

  if (
    role !== "assistant" &&
    role !== "prima"
  ) {
    return false;
  }

  const content =
    String(
      lastMessage?.content || ""
    ).trim();

  return (
    /\bwhat(?:['’]s| is)\s+your name\b/i
      .test(content) ||
    /\b(?:may|can|could)\s+i\s+(?:know|have|ask for)\s+your name\b/i
      .test(content) ||
    /\b(?:tell|share)\s+me\s+your name\b/i
      .test(content) ||
    /\bhow\s+should\s+i\s+address\s+you\b/i
      .test(content)
  );
}

export function extractMemoryFacts(
  message = "",
  {
    expectingName = false
  } = {}
) {
  const text =
    String(message).trim();

  const lower =
    text.toLowerCase();

  const facts = [];

  // Keep the original text for all other facts (search, budget, contact).
  // Only name parsing may ignore a short introductory greeting.
  const nameText = stripIntroGreeting(text);

  let match;

  // -------------------------------------------------------
  // NAME
  // -------------------------------------------------------

  // Explicit preferred names are Conversation/Memory, not Persona content.
  // Preserve the underlying action if a user combines a name with Search.
  match = text.match(
    /\bmy name is\s+([A-Za-z][A-Za-z' -]{0,40})/i
  );

  if (!match) {
    match = text.match(
      /\b(?:you can\s+|you may\s+)?call me\s+(?!back\b|later\b|tomorrow\b|today\b|at\b|on\b|for\b|about\b)([A-Za-z][A-Za-z' -]{0,40})/i
    );
  }

  if (match) {
    const parsedName = match[1]
      .replace(/[,;.!?][\s\S]*$/u, "")
      .replace(/\s+and\s+(?=(?:my\s+(?:phone|whats\s*app|whatsapp|email|number)\b|i(?:['’]?m|\s+am)\b|we(?:['’]?re|\s+are)\b))[\s\S]*$/i, "")
      .replace(/\s+(?:for (?:this|the) (?:conversation|chat)|instead of\b|from now on\b|and (?:find|search|show|compare|recommend|book|contact)\b)[\s\S]*$/i, "")
      .trim();
    // Fail closed rather than persist an action or sentence as a name.
    if (/^(?:call|contact|message|later|tomorrow|back|now|at|for)$/i.test(parsedName) ||
        parsedName.split(/\s+/).length > 3) match = null;
    else match[1] = parsedName;
  }

    if (!match) {
      /*
        Explicit preferred name + intent.

        I'm Zack, looking for a villa...
        I'm Mohammed Ali — show me apartments...
      */
      match = nameText.match(
        /^I(?:['’]?m|\s+am)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})\s*[,;:—-]\s*.+$/i
      );
    }

    if (!match) {
      /*
        Explicit preferred name + intent without punctuation.

        I'm Zack looking for a villa...
        I'm Mohammed Ali show me apartments...
      */
      match = nameText.match(
        /^I(?:['’]?m|\s+am)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}?)\s+(?=(?:looking|searching|show|find|need|want|interested|buying|seeking|after)\b).+$/i
      );
    }

    if (!match) {
      // Explicit name followed by an action joined with "and".
      // Do not treat arbitrary "I'm X and Y" descriptions as names.
      match = nameText.match(
        /^I(?:['’]?m|\s+am)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}?)\s+and\s+(?=(?:looking|searching|show|find|need|want|interested|buying|seeking|after|search)\b).+$/i
      );
    }

    if (!match) {
      /*
        Standalone preferred name.
      */
      match = nameText.match(
        /^I(?:['’]?m|\s+am)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})[.!]?$/i
      );
    }

    if (
      !match &&
      expectingName
    ) {
      /*
        Prima has just asked how to address the user.

        Zack, looking for a villa
        Dany — show me apartments
        Mohammed Ali, I need something under AED 3M

        Only user_name is extracted.
        Full original message continues unchanged.
      */
      match = text.match(
        /^([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})\s*[,;:—-]\s*.+$/i
      );
    }

    if (
      !match &&
      expectingName
    ) {
      /*
        Same case without punctuation:

        Zack looking for a villa
        Dany show me apartments
      */
      match = text.match(
        /^([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}?)\s+(?=(?:looking|searching|show|find|need|want|interested|buying|seeking|after)\b).+$/i
      );
    }

  if (
    match &&
    looksLikeBareName(match[1]) &&
    isEvidenceBackedUserName(message, match[1], {expectingName}) &&
    !looksLikeQuestionOrRequest(match[1]) &&
      !/^(?:i|i['’]?m|im|my|we|we['’]?re|were)$/i.test(String(match[1]).trim()) &&
    !/^(?:looking|searching|show|find|need|want|interested|buying|seeking|after|planning|trying|hoping|waiting|thinking|wondering|here|just|ready|sorry|not)\b/i.test(match[1])
  ) {
    setFact(
      facts,
      "user_name",
      normalizePreferredName(
        match[1]
      ),
      0.99
    );
  } else if (
    expectingName &&
    !looksLikeQuestionOrRequest(text) &&
    looksLikeBareName(text) &&
    /^[A-Z]/.test(text) &&
    text.split(/\s+/).length <= 3
  ) {
    setFact(
      facts,
      "user_name",
      normalizePreferredName(
        text
      ),
      0.97
    );
  }

  // -------------------------------------------------------
  // PREFERRED LANGUAGE — explicit only
  // -------------------------------------------------------

  match = text.match(
    /\b(?:please\s+)?(?:speak|reply|answer)\s+(?:to me\s+)?in\s+(english|russian|arabic|hindi|chinese|spanish|french|german)\b/i
  );

  if (!match) {
    match = text.match(
      /\bi prefer\s+(english|russian|arabic|hindi|chinese|spanish|french|german)\b/i
    );
  }

  if (match) {
    setFact(
      facts,
      "preferred_language",
      match[1].toLowerCase(),
      0.99
    );
  }

  // -------------------------------------------------------
  // AED BUDGET RANGE
  // -------------------------------------------------------

  match = text.match(
    /\b(?:budget(?:\s+is|\s+around|\s+about|\s+between)?|between)\s*(?:aed|dh|dhs)?\s*(\d+(?:[.,]\d+)?\s*[mk]?)\s*(?:-|–|to|and)\s*(?:aed|dh|dhs)?\s*(\d+(?:[.,]\d+)?\s*[mk]?)\b/i
  );

  if (match) {
    let firstRaw =
      match[1].replace(",", ".");

    let secondRaw =
      match[2].replace(",", ".");

    const secondSuffix =
      secondRaw.match(/[mk]\s*$/i)?.[0];

    if (
      secondSuffix &&
      !/[mk]\s*$/i.test(firstRaw)
    ) {
      firstRaw += secondSuffix;
    }

    const first =
      parseCompactNumber(firstRaw);

    const second =
      parseCompactNumber(secondRaw);

    if (
      first &&
      second
    ) {
      setFact(
        facts,
        "budget_min_aed",
        Math.min(first, second),
        0.97
      );

      setFact(
        facts,
        "budget_max_aed",
        Math.max(first, second),
        0.97
      );
    }
  } else {
    // -----------------------------------------------------
    // AED MAX / SINGLE BUDGET
    // -----------------------------------------------------

    match = text.match(
      /\b(?:budget(?:\s+is|\s+around|\s+about|\s+of)?|under|up to|max(?:imum)?(?:\s+budget)?(?:\s+of)?)\s*(?:aed|dh|dhs)?\s*(\d+(?:[.,]\d+)?\s*[mk]?)/i
    );

    if (!match) {
      match = text.match(
        /\b(?:aed|dh|dhs)\s*(\d+(?:[.,]\d+)?\s*[mk]?)/i
      );
    }

    if (match) {
      const amount =
        parseCompactNumber(
          match[1].replace(",", ".")
        );

      if (amount) {
        setFact(
          facts,
          "budget_max_aed",
          amount,
          0.95
        );
      }
    }
  }

  // -------------------------------------------------------
  // BEDROOMS — preference only
  // Avoid remembering a bedroom count from a generic
  // factual question such as "Does it have 2BR?"
  // -------------------------------------------------------

  match = lower.match(
    /\b(?:i(?:'m| am)?\s+(?:looking for|seeking)|we(?:'re| are)?\s+(?:looking for|seeking)|i\s+(?:want|need|prefer)|we\s+(?:want|need|prefer))\s+(?:an?\s+)?(\d+)\s*[- ]?\s*(?:br|bed|beds|bedroom|bedrooms)\b/
  );

  if (match) {
    setFact(
      facts,
      "bedrooms",
      Number(match[1]),
      0.98
    );
  }

  // -------------------------------------------------------
  // CHILDREN — explicit personal context only
  // -------------------------------------------------------

  match = lower.match(
    /\b(?:i|we)\s+have\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:children|kids)\b/
  );

  if (!match) {
    match = lower.match(
      /\bwith\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:children|kids)\b/
    );
  }

  if (match) {
    const value =
      numberWords[match[1]] ??
      Number(match[1]);

    setFact(
      facts,
      "children_count",
      value,
      0.97
    );

    setFact(
      facts,
      "family_context",
      "family_with_children",
      0.95
    );
  } else if (
    /\b(for my family|with my family|our family|my wife|my husband)\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "family_context",
      "family_household",
      0.9
    );
  }

  // -------------------------------------------------------
  // BUYER GOAL — explicit personal intent only
  // -------------------------------------------------------
  // Hypothetical questions must not become durable buyer goals.
  const goalQuestion = looksLikeQuestionOrRequest(text);

  const investmentNegated =
    /\b(?:not|never|rather than|instead of|without)\s+(?:an?\s+)?(?:investment|investing|invest)\b/i.test(text) ||
    /\b(?:do|does|did|am|are|was|were)\s+not\s+(?:want|looking\s+for|interested\s+in|planning|trying)\s+(?:an?\s+)?(?:investment|investing|invest)\b/i.test(text);

  const personalUseDeclared =
    /\bfor\s+(?:my|our)\s+family\s+to\s+live\s+in\b/i.test(text) ||
    /\b(?:it|this)(?:'s| is)\s+for\s+(?:living|(?:my|our)\s+family)\b/i.test(text) ||
    /\b(?:i|we)\b.{0,55}\b(?:own use|personal use|move in|live there|live in it|family home|primary residence)\b/i.test(text);

  if (!goalQuestion) {
    if (personalUseDeclared) {
      setFact(facts, "buyer_goal", "personal_use", 0.96);
    } else if (
      /\b(?:i|we)\b.{0,45}\b(?:second home|holiday home)\b/i.test(text) &&
      !/\bnot\s+(?:a\s+)?(?:second|holiday)\s+home\b/i.test(text)
    ) {
      setFact(facts, "buyer_goal", "second_home", 0.95);
    } else if (
      !investmentNegated &&
      (
        /\b(?:i|we)\b.{0,55}\b(?:invest|investing|investment|rental income|capital appreciation)\b/i.test(text) ||
        /\b(?:buying|looking for|searching for)\s+(?:a\s+)?property\s+for\s+investment\b/i.test(text)
      )
    ) {
      setFact(facts, "buyer_goal", "investment", 0.93);
    }
  }

  // -------------------------------------------------------
    // FINANCING — explicit personal financing intent
  // -------------------------------------------------------

  if (
    /\b(?:i|we)\b.{0,45}\b(mortgage|financing|finance the purchase)\b/i
      .test(text) ||
    /\b(?:buying|paying)\s+with\s+(?:a\s+)?mortgage\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "financing",
      "mortgage",
      0.97
    );
  } else if (
    /\b(?:i(?:'m| am)?\s+a\s+cash buyer|we(?:'re| are)?\s+cash buyers?|i(?:'ll| will)?\s+pay\s+cash|we(?:'ll| will)?\s+pay\s+cash|buying\s+cash)\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "financing",
      "cash",
      0.97
    );
  }

  // -------------------------------------------------------
  // RESIDENCE LOCATION — raw text, no city/country guessing
  // -------------------------------------------------------

  match = text.match(
    /\b(?:i live in|i(?:'m| am) based in|i(?:'m| am) from)\s+([A-Za-z][A-Za-z' .-]{1,60}?)(?:[,.!?]|$)/i
  );

  if (match) {
    setFact(
      facts,
      "residence_location_text",
      cleanTextValue(match[1], 60),
      0.94
    );
  }

  // -------------------------------------------------------
  // LOCATION PREFERENCE — explicit property intent only
  // -------------------------------------------------------

  match = text.match(
    /\b(?:i(?:'m| am)?\s+looking for|we(?:'re| are)?\s+looking for|i\s+(?:want|need|prefer)|we\s+(?:want|need|prefer)).{0,55}?\b(?:in|around|near)\s+([A-Za-z][A-Za-z0-9' .-]{2,60}?)(?:[,.!?]|$)/i
  );

  if (!match) {
    match = text.match(
      /\b(?:i|we)\s+(?:prefer|like)\s+(?:the\s+)?(?:area|district|community|location)\s+(?:of\s+)?([A-Za-z][A-Za-z0-9' .-]{2,60}?)(?:[,.!?]|$)/i
    );
  }

  if (match) {
    const value = normalizePreferredLocationTextV1(
      cleanTextValue(match[1], 80)
    );

    if (value) {
      setFact(
        facts,
        "preferred_location_text",
        value,
        0.88
      );
    }
  }

  // -------------------------------------------------------
  // PROPERTY TYPE — explicit preference only
  // -------------------------------------------------------

  match = lower.match(
    /\b(?:i(?:'m| am)?\s+(?:looking for|seeking)|we(?:'re| are)?\s+(?:looking for|seeking)|i\s+(?:want|need|prefer)|we\s+(?:want|need|prefer))\s+(?:an?\s+)?(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*[- ]?\s*(?:br|bed|beds|bedroom|bedrooms)\s+)?(studio|apartment|villa|townhouse|penthouse|duplex|plot)\b/
  );

  if (match) {
    setFact(
      facts,
      "property_type",
      match[1],
      0.97
    );
  }

  // -------------------------------------------------------
  // READY / OFF-PLAN PREFERENCE
  // -------------------------------------------------------

  if (
    /\b(?:i|we)\b.{0,55}\b(off[- ]?plan)\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "property_stage_preference",
      "off_plan",
      0.94
    );
  } else if (
    /\b(?:i|we)\b.{0,55}\b(ready property|ready unit|ready to move|move[- ]?in ready)\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "property_stage_preference",
      "ready",
      0.94
    );
  }

  // -------------------------------------------------------
  // PURCHASE TIMELINE — explicit personal timing
  // -------------------------------------------------------

  match = text.match(
    /\b(?:i|we)\b.{0,45}?\b(?:buy|purchase|move|invest).{0,30}?\b(within\s+\d+\s+(?:weeks?|months?|years?)|this year|next year|as soon as possible|asap)\b/i
  );

  if (!match) {
    match = text.match(
      /\b(?:planning|looking|hoping)\s+to\s+(?:buy|purchase|move|invest).{0,30}?\b(within\s+\d+\s+(?:weeks?|months?|years?)|this year|next year|as soon as possible|asap)\b/i
    );
  }

  if (match) {
    setFact(
      facts,
      "purchase_timeline_text",
      cleanTextValue(match[1], 50),
      0.91
    );
  }

  // -------------------------------------------------------
  // INVESTMENT HORIZON
  // -------------------------------------------------------

  match = text.match(
    /\b(?:investment horizon(?:\s+is)?|planning to hold(?: it)? for|plan to hold(?: it)? for|hold(?:ing)? for)\s+(\d+\s*(?:years?|months?))\b/i
  );

  if (match) {
    setFact(
      facts,
      "investment_horizon_text",
      cleanTextValue(match[1], 30),
      0.94
    );
  }

  // -------------------------------------------------------
  // OCCUPATION
  // -------------------------------------------------------

  match = text.match(
    /\bi work as\s+(?:an?\s+)?([A-Za-z][A-Za-z' &.-]{1,60}?)(?:[,.!?]|$)/i
  );

  if (!match) {
    match = text.match(
      /\bi(?:'m| am)\s+(?:an?\s+)([A-Za-z][A-Za-z' &.-]{1,60}?)(?:[,.!?]|$)/i
    );
  }

  if (match) {
    const value =
      cleanTextValue(match[1], 60);

    if (
      value &&
      !/^(buyer|investor|cash buyer)$/i
        .test(value)
    ) {
      setFact(
        facts,
        "occupation_text",
        value,
        0.9
      );
    }
  }

  // -------------------------------------------------------
  // BUSINESS SECTOR / BUSINESS CONTEXT
  // -------------------------------------------------------

  match = text.match(
    /\bi work in\s+([A-Za-z][A-Za-z' &.-]{1,60}?)(?:[,.!?]|$)/i
  );

  if (!match) {
    match = text.match(
      /\b(?:i run|i own|my business is in|my company is in)\s+(?:an?\s+)?([A-Za-z][A-Za-z' &.-]{1,60}?)(?:[,.!?]|$)/i
    );
  }

  if (match) {
    setFact(
      facts,
      "business_sector_text",
      cleanTextValue(match[1], 60),
      0.88
    );
  }

  // -------------------------------------------------------
  // RELOCATION
  // -------------------------------------------------------

  match = text.match(
    /\b(?:i(?:'m| am)?\s+(?:moving|relocating)|we(?:'re| are)?\s+(?:moving|relocating)|planning to\s+(?:move|relocate))\s+to\s+([A-Za-z][A-Za-z' .-]{1,60}?)(?:[,.!?]|$)/i
  );

  if (match) {
    setFact(
      facts,
      "relocation_destination_text",
      cleanTextValue(match[1], 60),
      0.96
    );
  }

  // -------------------------------------------------------
  // DUBAI VISIT PATTERN — explicit only
  // -------------------------------------------------------

  match = text.match(
    /\bi (?:come|visit|travel) to dubai\s+((?:every|about|around)\s+[A-Za-z0-9 -]+|often|frequently|regularly|occasionally)\b/i
  );

  if (match) {
    setFact(
      facts,
      "dubai_visit_pattern_text",
      cleanTextValue(match[1], 50),
      0.88
    );
  }

  // -------------------------------------------------------
  // LIFESTYLE PREFERENCES — only when client expresses
  // a personal preference in the same message.
  // -------------------------------------------------------

  const personalPreference =
    /\b(?:i|we)\b.{0,35}\b(?:want|need|prefer|like|looking for|important to me|important to us)\b/i
      .test(text);

  if (personalPreference) {
    const lifestyle = [];

    if (/\bwaterfront\b/i.test(text)) {
      lifestyle.push("waterfront");
    }

    if (
      /\bquiet|peaceful\b/i.test(text)
    ) {
      lifestyle.push("quiet");
    }

    if (
      /\bprivacy|private\b/i.test(text)
    ) {
      lifestyle.push("privacy");
    }

    if (
      /\bcentral|city centre|city center\b/i.test(text)
    ) {
      lifestyle.push("central");
    }

    if (
      /\bwalkable|walking distance\b/i.test(text)
    ) {
      lifestyle.push("walkable");
    }

    if (
      /\bfamily[- ]friendly\b/i.test(text)
    ) {
      lifestyle.push("family_friendly");
    }

    if (lifestyle.length) {
      setFact(
        facts,
        "lifestyle_preferences",
        lifestyle,
        0.9
      );
    }
  }

  // -------------------------------------------------------
  // RISK APPETITE — explicit only
  // -------------------------------------------------------

  if (
    /\b(?:i|we)\b.{0,35}\b(?:prefer|want|need).{0,20}\b(?:low risk|lower risk|conservative)\b/i
      .test(text) ||
    /\bi(?:'m| am)\s+conservative\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "risk_appetite",
      "low",
      0.92
    );
  } else if (
    /\b(?:i|we)\b.{0,35}\b(?:prefer|want|am comfortable with).{0,20}\b(?:moderate risk|balanced risk)\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "risk_appetite",
      "medium",
      0.9
    );
  } else if (
    /\b(?:i|we)\b.{0,35}\b(?:comfortable with|accept|prefer).{0,20}\b(?:high risk|higher risk|aggressive)\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "risk_appetite",
      "high",
      0.9
    );
  }

  return facts;
}

/*
  Canonical Memory value contract.

  One logical durable fact must have one JSON type
  regardless of producer (deterministic extraction,
  Request Interpreter, Funnel, etc.).

  This is especially important because PostgreSQL JSONB
  correctly treats 4000000 and "4000000" as different.
*/
const CANONICAL_NUMERIC_MEMORY_KEYS_V1 =
  new Set([
    "budget_min_aed",
    "budget_max_aed",
    "bedrooms",
    "children_count"
  ]);


export function normalizeMemoryFactValue(
  factKey,
  value
) {
  if (
    !CANONICAL_NUMERIC_MEMORY_KEYS_V1
      .has(factKey)
  ) {
    return value;
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const cleaned =
    value
      .trim()
      .replace(/,/g, "")
      .replace(/^AED\s*/i, "");

  const match =
    cleaned.match(
      /^(-?\d+(?:\.\d+)?)\s*([kKmM])?$/
    );

  if (!match) {
    return value;
  }

  const base =
    Number(match[1]);

  if (!Number.isFinite(base)) {
    return value;
  }

  const suffix =
    String(
      match[2] || ""
    ).toLowerCase();

  const multiplier =
    suffix === "m"
      ? 1000000
      : suffix === "k"
        ? 1000
        : 1;

  const normalized =
    base * multiplier;

  return Number.isFinite(normalized)
    ? normalized
    : value;
}


export function normalizeMemoryFacts(
  facts = []
) {
  const normalizedFacts = [];
  const seen = new Set();

  for (
    const fact of
    Array.isArray(facts)
      ? facts
      : []
  ) {
    if (
      !fact ||
      typeof fact !== "object"
    ) {
      continue;
    }

    const normalized = {
      ...fact,

      fact_value:
        normalizeMemoryFactValue(
          fact.fact_key,
          fact.fact_value
        )
    };

    let signature = null;

    try {
      signature =
        JSON.stringify([
          normalized.fact_key,
          normalized.fact_value
        ]);
    } catch {
      signature = null;
    }

    /*
      Collapse only identical canonical facts.

      Truly different values for the same key are preserved
      so normal Memory replacement semantics still work.
    */
    if (
      signature &&
      seen.has(signature)
    ) {
      continue;
    }

    if (signature) {
      seen.add(signature);
    }

    normalizedFacts.push(
      normalized
    );
  }

  return normalizedFacts;
}
