// PRIMA_QA_RUNTIME_TRACE_R22417 — Opt-in transport envelope only.
// PT07: Bound only the HTTP transport. SQL, writes, idempotency and
// persistence decisions remain owned by the existing Supabase modules.
// A timed-out write is NOT retried: its server-side commit status is unknown.
async function boundedSupabaseTransportFetch(env, url, options) {
  const requestedMs = Number(env?.PRIMA_SUPABASE_FETCH_TIMEOUT_MS);
  const lowerBound = env?.PRIMA_QA_RUNTIME_TRACE === "1" ? 50 : 5000;
  const timeoutMs = Number.isFinite(requestedMs)
    && requestedMs >= lowerBound && requestedMs <= 60000
      ? requestedMs : 30000;
  const previousSignal = options?.signal;
  const controller = new AbortController();
  const relay = () => controller.abort(previousSignal?.reason);
  if (previousSignal?.aborted) relay();
  else previousSignal?.addEventListener?.("abort", relay, {once:true});
  let timer = null;
  let timedOut = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("supabase_transport_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetch(url, {...options, signal:controller.signal}), deadline
    ]);
  } catch (error) {
    if (timedOut) throw new Error("supabase_transport_timeout");
    throw error;
  } finally {
    if (timer !== null) clearTimeout(timer);
    previousSignal?.removeEventListener?.("abort", relay);
  }
}

async function qaSupabaseFetch(env, url, options) {
  if (env?.PRIMA_QA_RUNTIME_TRACE !== "1") return boundedSupabaseTransportFetch(env,url,options);
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const rpc = path.includes("rpc") ? path[path.indexOf("rpc")+1] : null;
  const table = rpc ? null : path[path.length-1];
  const method = String(options?.method || "GET").toUpperCase();
  // Never create actual commercial leads in an instrumented QA run.
  if (rpc === "create_lead_v1" || table === "leads") {
    console.info("PRIMA_QA_TRACE",JSON.stringify({version:"R2.24.17",
      stage:"db_blocked",module:"src/supabase.js",fn:"qaSupabaseFetch",
      operation:rpc || table,reason:"commercial_lead_protection"}));
    throw new Error("qa_commercial_lead_blocked");
  }
  const started=Date.now();
  try {
    const result=await boundedSupabaseTransportFetch(env,url,options);
    console.info("PRIMA_QA_TRACE",JSON.stringify({version:"R2.24.17",
      stage:"supabase_http",module:"src/supabase.js",fn:"qaSupabaseFetch",
      operation:rpc || table || "unknown",method,status:result.status,
      duration_ms:Date.now()-started}));
    // QA-only diagnostic: read a cloned ERROR response. Never log body,
    // message, detail, hint, URL, query, request payload or credentials.
    // The original Response remains untouched for existing error handlers.
    if (!result.ok) {
      try {
        const errorData = await result.clone().json();
        const code = typeof errorData?.code === "string" &&
          /^[A-Za-z0-9_]{1,32}$/.test(errorData.code)
            ? errorData.code : null;
        console.info("PRIMA_QA_TRACE",JSON.stringify({version:"R2.24.25",
          stage:"supabase_error_code",module:"src/supabase.js",fn:"qaSupabaseFetch",
          operation:rpc || table || "unknown",method,status:result.status,
          error_code:code}));
      } catch {
        console.info("PRIMA_QA_TRACE",JSON.stringify({version:"R2.24.25",
          stage:"supabase_error_code",module:"src/supabase.js",fn:"qaSupabaseFetch",
          operation:rpc || table || "unknown",method,status:result.status,
          error_code:null}));
      }
    }
    return result;
  } catch (error) {
    console.info("PRIMA_QA_TRACE",JSON.stringify({version:"R2.24.17",
      stage:"supabase_http",module:"src/supabase.js",fn:"qaSupabaseFetch",
      operation:rpc || table || "unknown",method,status:"network_error",
      duration_ms:Date.now()-started}));
    throw error;
  }
}

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
  options,
  env = null
) {
  try {
    return await qaSupabaseFetch(
        env,
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
      return await qaSupabaseFetch(
        env,
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
  const res = await qaSupabaseFetch(
        env,
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
  const res = await qaSupabaseFetch(
        env,
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
  const res = await qaSupabaseFetch(
        env,
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
  const res = await qaSupabaseFetch(
        env,
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
  const res = await qaSupabaseFetch(
        env,
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
      }, env
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
      }, env
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
      }, env
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
