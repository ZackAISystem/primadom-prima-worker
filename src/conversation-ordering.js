function validTurnSeq(value) {
  const n =
    Number(value);

  return (
    Number.isInteger(n) &&
    n > 0
  )
    ? n
    : null;
}


function validTurnId(value) {
  const id =
    String(value || "")
      .trim();

  return id || null;
}


/*
  ConversationOrderingV1

  state_version intentionally tracks the highest
  successfully applied turn_seq.

  This gives us one monotonic ordering value without
  computing old_version + 1 in application code.
*/
export function buildConversationOrderingV1({
  conversationId,
  turn
} = {}) {
  const id =
    String(
      conversationId ||
      ""
    ).trim();

  const turnSeq =
    validTurnSeq(
      turn?.turn_seq
    );

  const turnId =
    validTurnId(
      turn?.turn_id
    );

  if (
    !id ||
    turnSeq === null ||
    !turnId
  ) {
    return {
      version:
        "ConversationOrderingV1",

      guarded:
        false,

      query:
        id
          ? `conversation_id=eq.${id}`
          : null,

      patch:
        {}
    };
  }

  return {
    version:
      "ConversationOrderingV1",

    guarded:
      true,

    turn_id:
      turnId,

    turn_seq:
      turnSeq,

    /*
      PostgREST:
      apply only when no completed turn has been
      recorded yet OR the stored turn is older.
    */
    query:
      (
        `conversation_id=eq.${id}` +
        `&or=(last_applied_turn_seq.is.null,` +
        `last_applied_turn_seq.lt.${turnSeq})`
      ),

    patch: {
      state_version:
        turnSeq,

      last_applied_turn_id:
        turnId,

      last_applied_turn_seq:
        turnSeq
    }
  };
}
