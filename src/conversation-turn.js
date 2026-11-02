function createTurnId() {
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return (
    "turn_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 12)
  );
}


export function normalizeConversationTurn(
  body = {}
) {
  const raw =
    body?.turn &&
    typeof body.turn === "object"
      ? body.turn
      : {};

  const suppliedId =
    String(
      raw?.turn_id || ""
    ).trim();

  const turnId =
    /^[A-Za-z0-9_-]{8,128}$/.test(
      suppliedId
    )
      ? suppliedId
      : createTurnId();

  const parsedSeq =
    Number(raw?.turn_seq);

  const turnSeq =
    Number.isSafeInteger(parsedSeq) &&
    parsedSeq > 0
      ? parsedSeq
      : null;

  const phase =
    raw?.phase === "tool_continuation"
      ? "tool_continuation"
      : "initial";

  return {
    version:
      "ConversationTurnV1",

    turn_id:
      turnId,

    turn_seq:
      turnSeq,

    phase
  };
}
