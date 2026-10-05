import {
  resolveFollowUpReference
} from "./follow-up.js";


function normalizeComparable(
  value = ""
) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function projectFromSlug(
  slug,
  source
) {
  const normalizedSlug =
    String(slug || "")
      .trim()
      .toLowerCase();

  if (!normalizedSlug) {
    return null;
  }

  return {
    type: "project",
    slug: normalizedSlug,
    source
  };
}


function currentProject(
  context
) {
  if (
    context
      ?.entity
      ?.primary_type !== "project" ||
    !context
      ?.entity
      ?.primary_slug
  ) {
    return null;
  }

  return projectFromSlug(
    context.entity.primary_slug,
    "current_context"
  );
}


function targetMatchesProject(
  target,
  project
) {
  if (!target || !project?.slug) {
    return false;
  }

  const targetText =
    normalizeComparable(target);

  const projectText =
    normalizeComparable(
      project.slug.replace(/-/g, " ")
    );

  if (
    !targetText ||
    !projectText
  ) {
    return false;
  }

  return (
    targetText === projectText ||
    targetText.includes(projectText) ||
    projectText.includes(targetText)
  );
}


function recentMatchingProject(
  target,
  context
) {
  const messages =
    Array.isArray(
      context
        ?.conversation
        ?.recent_messages
    )
      ? context.conversation.recent_messages
      : [];

  for (
    let i = messages.length - 1;
    i >= 0;
    i--
  ) {
    const item =
      messages[i];

    if (
      item?.primary_entity_type !==
        "project" ||
      !item?.primary_entity_slug
    ) {
      continue;
    }

    const project =
      projectFromSlug(
        item.primary_entity_slug,
        "recent_message"
      );

    if (
      targetMatchesProject(
        target,
        project
      )
    ) {
      return project;
    }
  }

  return null;
}


function messageMentionsProject(
  message,
  project
) {
  if (!project?.slug) {
    return false;
  }

  const messageText =
    normalizeComparable(message);

  const projectText =
    normalizeComparable(
      project.slug.replace(/-/g, " ")
    );

  return Boolean(
    messageText &&
    projectText &&
    messageText.includes(
      projectText
    )
  );
}


function recentMentionedProject(
  message,
  context
) {
  const messages =
    Array.isArray(
      context
        ?.conversation
        ?.recent_messages
    )
      ? context.conversation.recent_messages
      : [];

  for (
    let i = messages.length - 1;
    i >= 0;
    i--
  ) {
    const item =
      messages[i];

    if (
      item?.primary_entity_type !==
        "project" ||
      !item?.primary_entity_slug
    ) {
      continue;
    }

    const project =
      projectFromSlug(
        item.primary_entity_slug,
        "recent_message"
      );

    if (
      messageMentionsProject(
        message,
        project
      )
    ) {
      return project;
    }
  }

  return null;
}


function detectDecisionStatus(
  message = ""
) {
  const text =
    String(message).trim();

  if (
    /\b(?:i|we)\s+(?:do not|don't|dont)\s+(?:like|want|prefer)\b/i
      .test(text) ||
    /\bnot\s+for\s+(?:me|us)\b/i
      .test(text) ||
    /\breject(?:ed)?\b/i
      .test(text) ||
    /\b(?:remove|take)\b.*\b(?:from|off)\b.*\bshortlist\b/i
      .test(text) ||
    /\bskip\s+(?:this|that|it)\b/i
      .test(text)
  ) {
    return "rejected";
  }

  if (
    /\b(?:add|put|save)\b.*\bshortlist\b/i
      .test(text) ||
    /\bshortlist\s+(?:this|that|it|the\s+(?:first|second|third)\s+one|[a-z0-9])/i
      .test(text)
  ) {
    return "shortlisted";
  }

  if (
    /\bi(?:'m| am)\s+(?:really\s+)?interested\s+in\b/i
      .test(text) ||
    /\bwe(?:'re| are)\s+(?:really\s+)?interested\s+in\b/i
      .test(text) ||
    /\b(?:i|we)\s+(?:really\s+)?(?:like|love|prefer)\b/i
      .test(text) ||
    /\blooks?\s+(?:good|interesting)\s+(?:to|for)\s+(?:me|us)\b/i
      .test(text)
  ) {
    return "interested";
  }

  return null;
}


export function hasEntityDecisionSignal(
  message = ""
) {
  return Boolean(
    detectDecisionStatus(message)
  );
}


function extractExplicitTarget(
  message = ""
) {
  const text =
    String(message).trim();

  const patterns = [
    /\b(?:i|we)\s+(?:do not|don't|dont)\s+(?:like|want|prefer)\s+(.+?)(?:\s+(?:because|since|due to)\b|[.!?]|$)/i,

    /\b(?:i|we)\s+(?:like|love|prefer)\s+(.+?)(?:\s+(?:because|since|due to)\b|[.!?]|$)/i,

    /\bi(?:'m| am)\s+(?:really\s+)?interested\s+in\s+(.+?)(?:\s+(?:because|since|due to)\b|[.!?]|$)/i,

    /\bwe(?:'re| are)\s+(?:really\s+)?interested\s+in\s+(.+?)(?:\s+(?:because|since|due to)\b|[.!?]|$)/i,

    /\b(?:add|put|save)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+|the\s+)?shortlist\b/i,

    /\bshortlist\s+(.+?)(?:[.!?]|$)/i,

    /\breject\s+(.+?)(?:\s+(?:because|since|due to)\b|[.!?]|$)/i
  ];

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      return String(
        match[1]
      ).trim();
    }
  }

  return null;
}


function rejectionReason(
  message = ""
) {
  const text =
    String(message).trim();

  const match =
    text.match(
      /\b(?:because|since|due to)\s+(.+)$/i
    );

  if (!match?.[1]) {
    return null;
  }

  const reason =
    String(match[1])
      .trim()
      .replace(
        /^[,.;:!? ]+|[,.;:!? ]+$/g,
        ""
      )
      .replace(/\s+/g, " ")
      .slice(0, 180)
      .trim();

  return reason || null;
}


function resolveDecisionProject({
  message,
  context,
  status
}) {
  const followUp =
    resolveFollowUpReference({
      message,
      context
    });

  if (
    followUp?.resolved &&
    followUp?.type === "project" &&
    followUp?.slug
  ) {
    return projectFromSlug(
      followUp.slug,
      followUp.source ||
        "follow_up"
    );
  }

  const explicitTarget =
    extractExplicitTarget(
      message
    );

  const current =
    currentProject(
      context
    );

  if (explicitTarget) {
    if (
      current &&
      targetMatchesProject(
        explicitTarget,
        current
      )
    ) {
      return current;
    }

    const recent =
      recentMatchingProject(
        explicitTarget,
        context
      );

    if (recent) {
      return recent;
    }

    /*
      Explicit target exists but has not been
      resolved to a stable project slug.
      High-confidence Memory must not guess.
    */
    return null;
  }

  if (
    current &&
    messageMentionsProject(
      message,
      current
    )
  ) {
    return current;
  }

  const recentMention =
    recentMentionedProject(
      message,
      context
    );

  if (recentMention) {
    return recentMention;
  }

  /*
    A decision statement with no competing
    explicit project name can refer naturally
    to the currently resolved project.
    Examples:
      "Not for me."
      "I'm interested."
  */
  if (
    status &&
    current
  ) {
    return current;
  }

  return null;
}


function hasExistingDecision(
  activeMemory,
  factKey
) {
  return Array.isArray(activeMemory) &&
    activeMemory.some(
      item =>
        item?.fact_key === factKey
    );
}


export function extractEntityDecisionFacts({
  message = "",
  context = null,
  activeMemory = []
} = {}) {
  const status =
    detectDecisionStatus(
      message
    );

  const project =
    resolveDecisionProject({
      message,
      context,
      status
    });

  if (!project?.slug) {
    return [];
  }

  const mentionedKey =
    `project_mentioned:${project.slug}`;

  const decisionKey =
    `project_decision:${project.slug}`;

  const facts = [
    {
      fact_key:
        mentionedKey,

      fact_value: {
        entity_type:
          "project",

        entity_slug:
          project.slug
      },

      confidence:
        0.98
    }
  ];

  /*
    A plain mention must never downgrade an
    existing interested/shortlisted/rejected
    decision for the same project.
  */
  if (
    !status &&
    hasExistingDecision(
      activeMemory,
      decisionKey
    )
  ) {
    return facts;
  }

  const finalStatus =
    status ||
    "mentioned";

  facts.push({
    fact_key:
      decisionKey,

    fact_value: {
      entity_type:
        "project",

      entity_slug:
        project.slug,

      status:
        finalStatus,

      reason:
        finalStatus ===
          "rejected"
          ? rejectionReason(
              message
            )
          : null
    },

    confidence:
      finalStatus ===
        "mentioned"
        ? 0.95
        : 0.99
  });

  return facts;
}
