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

  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([mk])?$/i);

  if (!match) return null;

  let value = Number(match[1]);

  if (match[2] === "m") value *= 1000000;
  if (match[2] === "k") value *= 1000;

  return Math.round(value);
}

export function extractMemoryFacts(message = "") {
  const text = String(message).trim();
  const lower = text.toLowerCase();

  const facts = [];

  // -------------------------------------------------------
  // NAME
  // -------------------------------------------------------

  let match = text.match(
    /\bmy name is\s+([A-Za-z][A-Za-z' -]{1,40})/i
  );

  if (!match) {
    match = text.match(
      /\bcall me\s+([A-Za-z][A-Za-z' -]{1,40})/i
    );
  }

  if (match) {
    facts.push({
      fact_key: "user_name",
      fact_value: match[1].trim(),
      confidence: 0.99
    });
  }

  // -------------------------------------------------------
  // AED BUDGET
  // -------------------------------------------------------

  match = text.match(
    /\b(?:budget(?:\s+is|\s+around|\s+about|\s+of)?|under|up to|max(?:imum)?(?:\s+budget)?(?:\s+of)?)\s*(?:aed|dh|dhs)?\s*(\d+(?:[.,]\d+)?\s*[mk]?)/i
  );

  if (!match) {
    match = text.match(
      /\b(?:aed|dh|dhs)\s*(\d+(?:[.,]\d+)?\s*[mk]?)/i
    );
  }

  if (match) {
    const amount = parseCompactNumber(match[1]);

    if (amount) {
      facts.push({
        fact_key: "budget_max_aed",
        fact_value: amount,
        confidence: 0.95
      });
    }
  }

  // -------------------------------------------------------
  // BEDROOMS
  // -------------------------------------------------------

  match = lower.match(
    /\b(\d+)\s*(?:br|bed|beds|bedroom|bedrooms)\b/
  );

  if (match) {
    facts.push({
      fact_key: "bedrooms",
      fact_value: Number(match[1]),
      confidence: 0.98
    });
  }

  // -------------------------------------------------------
  // CHILDREN
  // -------------------------------------------------------

  match = lower.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:children|kids)\b/
  );

  if (match) {
    const value =
      numberWords[match[1]] ??
      Number(match[1]);

    facts.push({
      fact_key: "children_count",
      fact_value: value,
      confidence: 0.95
    });
  }

  // -------------------------------------------------------
  // BUYER GOAL
  // -------------------------------------------------------

  if (
    /\b(invest|investment|roi|rental income|capital appreciation)\b/i.test(text)
  ) {
    facts.push({
      fact_key: "buyer_goal",
      fact_value: "investment",
      confidence: 0.9
    });
  } else if (
    /\b(live|living|family home|own use|personal use|move in)\b/i.test(text)
  ) {
    facts.push({
      fact_key: "buyer_goal",
      fact_value: "personal_use",
      confidence: 0.9
    });
  }

  // -------------------------------------------------------
  // FINANCING
  // -------------------------------------------------------

  if (/\bmortgage\b/i.test(text)) {
    facts.push({
      fact_key: "financing",
      fact_value: "mortgage",
      confidence: 0.95
    });
  } else if (
    /\bcash buyer\b|\bbuying cash\b|\bpay cash\b/i.test(text)
  ) {
    facts.push({
      fact_key: "financing",
      fact_value: "cash",
      confidence: 0.95
    });
  }

  // -------------------------------------------------------
  // LOCATION PREFERENCE — preliminary text only.
  // Later Entity Resolver will convert this into district/project IDs.
  // -------------------------------------------------------

  match = text.match(
    /\b(?:prefer|interested in|considering|like)\s+([A-Za-z][A-Za-z0-9' -]{2,60}?)(?:[,.!?]|$)/i
  );

  if (match) {
    const value = match[1].trim();

    if (
      !/^(something|anything|it|this|that)$/i.test(value)
    ) {
      facts.push({
        fact_key: "preferred_location_text",
        fact_value: value,
        confidence: 0.7
      });
    }
  }

  // -------------------------------------------------------
  // PURCHASE TIMELINE
  // -------------------------------------------------------

  match = text.match(
    /\b(within\s+\d+\s+(?:weeks?|months?|years?)|this year|next year|as soon as possible|asap)\b/i
  );

  if (match) {
    facts.push({
      fact_key: "purchase_timeline_text",
      fact_value: match[1],
      confidence: 0.85
    });
  }

  return facts;
}
