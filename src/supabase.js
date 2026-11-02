function headers(env) {
  if (!env.SUPABASE_REST_URL || !env.SUPABASE_SECRET_KEY) {
    throw new Error("supabase_not_configured");
  }

  return {
    apikey: env.SUPABASE_SECRET_KEY,
    "content-type": "application/json",
    "accept-profile": "prima",
    "content-profile": "prima"
  };
}

async function fetchReadWithRetry(
  url,
  options
) {
  try {
    return await fetch(
      url,
      options
    );
  } catch (firstError) {
    console.warn(
      "supabase_read_retry",
      firstError?.message ||
      String(firstError)
    );

    try {
      return await fetch(
        url,
        options
      );
    } catch (secondError) {
      throw new Error(
        "supabase_network_failed:" +
        (
          secondError?.message ||
          String(secondError)
        )
      );
    }
  }
}


export async function supabaseInsert(
  env,
  table,
  body,
  select = "*"
) {
  const res = await fetch(
    `${env.SUPABASE_REST_URL}/${table}?select=${encodeURIComponent(select)}`,
    {
      method: "POST",
      headers: {
        ...headers(env),
        prefer: "return=representation"
      },
      body: JSON.stringify(body)
    }
  );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `supabase_insert_failed:${res.status}:${text}`
    );
  }

  return text ? JSON.parse(text) : [];
}


export async function supabaseInsertIdempotentMessage(
  env,
  table,
  body,
  select = "*"
) {
  const res = await fetch(
    `${env.SUPABASE_REST_URL}/${table}?select=${encodeURIComponent(select)}`,
    {
      method: "POST",

      headers: {
        ...headers(env),
        prefer:
          "return=representation"
      },

      body:
        JSON.stringify(body)
    }
  );

  const text =
    await res.text();

  if (res.ok) {
    return text
      ? JSON.parse(text)
      : [];
  }

  let errorBody = null;

  try {
    errorBody =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    errorBody = null;
  }

  const isTurnDuplicate =
    table === "messages" &&
    Boolean(body?.conversation_id) &&
    Boolean(body?.turn_id) &&
    Boolean(body?.role) &&
    res.status === 409 &&
    errorBody?.code === "23505" &&
    text.includes(
      "messages_conversation_turn_role_uidx"
    );

  if (!isTurnDuplicate) {
    throw new Error(
      `supabase_idempotent_message_insert_failed:${res.status}:${text}`
    );
  }

  /*
    PostgreSQL unique index is the concurrency authority.

    Normal traffic:
      one INSERT only.

    Retry / parallel duplicate:
      unique violation -> fetch canonical existing row.
  */
  const rows =
    await supabaseSelect(
      env,
      table,
      (
        `conversation_id=eq.${encodeURIComponent(body.conversation_id)}` +
        `&turn_id=eq.${encodeURIComponent(body.turn_id)}` +
        `&role=eq.${encodeURIComponent(body.role)}` +
        `&select=${encodeURIComponent(select)}` +
        `&limit=1`
      )
    );

  console.log(
    "prima_message_duplicate_ignored",
    JSON.stringify({
      conversation_id:
        body.conversation_id,

      turn_id:
        body.turn_id,

      turn_seq:
        body?.turn_seq ?? null,

      role:
        body.role
    })
  );

  return rows;
}



export async function supabaseInsertIdempotentEvent(
  env,
  table,
  body,
  select = "*"
) {
  const res = await fetch(
    `${env.SUPABASE_REST_URL}/${table}?select=${encodeURIComponent(select)}`,
    {
      method: "POST",

      headers: {
        ...headers(env),
        prefer:
          "return=representation"
      },

      body:
        JSON.stringify(body)
    }
  );

  const text =
    await res.text();

  if (res.ok) {
    return text
      ? JSON.parse(text)
      : [];
  }

  let errorBody = null;

  try {
    errorBody =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    errorBody = null;
  }

  const idempotentEventNames =
    new Set([
      "message_routed",
      "lead_contact_captured",
      "memory_fact_captured"
    ]);

  const isExpectedDuplicate =
    table === "conversation_events" &&
    Boolean(body?.message_id) &&
    idempotentEventNames.has(
      body?.event_name
    ) &&
    res.status === 409 &&
    errorBody?.code === "23505";

  if (isExpectedDuplicate) {
    console.log(
      "prima_event_duplicate_ignored",
      JSON.stringify({
        conversation_id:
          body?.conversation_id ||
          null,

        message_id:
          body?.message_id ||
          null,

        event_name:
          body?.event_name ||
          null,

        fact_key:
          body?.event_data
            ?.fact_key ||
          null
      })
    );

    return [];
  }

  throw new Error(
    `supabase_idempotent_event_insert_failed:${res.status}:${text}`
  );
}


export async function supabaseUpdate(
  env,
  table,
  query,
  body
) {
  const res = await fetch(
    `${env.SUPABASE_REST_URL}/${table}?${query}`,
    {
      method: "PATCH",
      headers: {
        ...headers(env),
        prefer: "return=minimal"
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const text = await res.text();

    throw new Error(
      `supabase_update_failed:${res.status}:${text}`
    );
  }
}


export async function supabaseUpdateReturning(
  env,
  table,
  query,
  body
) {
  const res = await fetch(
    `${env.SUPABASE_REST_URL}/${table}?${query}`,
    {
      method: "PATCH",

      headers: {
        ...headers(env),
        prefer:
          "return=representation"
      },

      body:
        JSON.stringify(body)
    }
  );

  const text =
    await res.text();

  if (!res.ok) {
    throw new Error(
      `supabase_update_returning_failed:${res.status}:${text}`
    );
  }

  return text
    ? JSON.parse(text)
    : [];
}


export async function supabaseSelect(
  env,
  table,
  query
) {
  const res =
    await fetchReadWithRetry(
      `${env.SUPABASE_REST_URL}/${table}?${query}`,
      {
        method: "GET",
        headers: headers(env)
      }
    );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `supabase_select_failed:${res.status}:${text}`
    );
  }

  return text ? JSON.parse(text) : [];
}


export async function supabaseRpc(
  env,
  functionName,
  payload = {}
) {
  const response =
    await fetchReadWithRetry(
      `${env.SUPABASE_REST_URL}/rpc/${functionName}`,
      {
        method: "POST",

        headers: {
          ...headers(env),
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      }
    );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `supabase_rpc_failed:${response.status}:${text}`
    );
  }

  return response.json();
}


export async function supabasePublicRpc(
  env,
  functionName,
  payload = {}
) {
  const response =
    await fetchReadWithRetry(
      `${env.SUPABASE_REST_URL}/rpc/${functionName}`,
      {
        method: "POST",

        headers: {
          ...headers(env),
          "accept-profile":
            "public",
          "content-profile":
            "public",
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      }
    );

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `supabase_public_rpc_failed:${response.status}:${body}`
    );
  }

  return response.json();
}
