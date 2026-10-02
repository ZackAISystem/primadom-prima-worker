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

export async function supabaseSelect(
  env,
  table,
  query
) {
  const res = await fetch(
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
  const response = await fetch(
    `${env.SUPABASE_REST_URL}/rpc/${functionName}`,
    {
      method: "POST",

      headers: {
        ...headers(env),
        "content-type": "application/json"
      },

      body: JSON.stringify(payload)
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
