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
    !/^[A-Za-z][A-Za-z' -]{1,39}$/
      .test(text)
  ) {
    return false;
  }

  const lower =
    text.toLowerCase();

  const blocked =
    new Set([
      "passo",
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
      "thanks",
      "thank you"
    ]);

  return !blocked.has(lower);
}

export function isContextualNameCandidate(
  message = ""
) {
  const text =
    String(message).trim();

  return (
    looksLikeBareName(text) &&
    text.split(/\s+/).length <= 3
  );
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

  let match;

  // -------------------------------------------------------
  // NAME
  // -------------------------------------------------------

  match = text.match(
    /\bmy name is\s+([A-Za-z][A-Za-z' -]{1,40})/i
  );

  if (!match) {
    match = text.match(
      /\bcall me\s+([A-Za-z][A-Za-z' -]{1,40})/i
    );
  }

  if (!match) {
    match = text.match(
      /^I(?:'|’)?m\s+([A-Z][A-Za-z' -]{1,40})[.!]?$/
    );
  }

  if (
    match &&
    looksLikeBareName(match[1])
  ) {
    setFact(
      facts,
      "user_name",
      cleanTextValue(match[1], 40),
      0.99
    );
  } else if (
    expectingName &&
    looksLikeBareName(text) &&
    text.split(/\s+/).length <= 3
  ) {
    setFact(
      facts,
      "user_name",
      cleanTextValue(text, 40),
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
    /\b(?:i(?:'m| am)?\s+(?:looking for|seeking)|we(?:'re| are)?\s+(?:looking for|seeking)|i\s+(?:want|need|prefer)|we\s+(?:want|need|prefer))\s+(?:an?\s+)?(\d+)\s*(?:br|bed|beds|bedroom|bedrooms)\b/
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

  if (
    /\b(?:i|we)\b.{0,45}\b(second home|holiday home)\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "buyer_goal",
      "second_home",
      0.95
    );
  } else if (
    /\b(?:i|we)\b.{0,55}\b(invest|investing|investment|rental income|capital appreciation)\b/i
      .test(text) ||
    /\b(?:buying|looking for|searching for)\s+(?:a\s+)?property\s+for\s+investment\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "buyer_goal",
      "investment",
      0.93
    );
  } else if (
    /\b(?:i|we)\b.{0,55}\b(own use|personal use|move in|live there|live in it|family home|primary residence)\b/i
      .test(text)
  ) {
    setFact(
      facts,
      "buyer_goal",
      "personal_use",
      0.93
    );
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
    const value =
      cleanTextValue(
        match[1],
        60
      );

    if (
      value &&
      !/^(something|anything|it|this|that|this project|that project)$/i
        .test(value)
    ) {
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
