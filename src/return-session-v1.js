// PRIMA RESTORE-03A — browser return session, host-only HttpOnly cookie.
// This capability identifies a browser session, not a verified person.
// No user facts, contact PII, or conversation messages are stored in cookies.
const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TTL_SECONDS = 30 * 24 * 60 * 60;
const PROD_API_HOSTS = new Set(['api.prima.primadom.ai', 'prima.primadom.ai', 'api.primadom.ai', 'api-staging.primadom.ai']);
const LOCAL_API_HOSTS = new Set(['localhost', '127.0.0.1']);
const TRUSTED_UI_ORIGINS = new Set([
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://prima.primadom.ai',
  'https://prima-staging.primadom.ai'
]);

export function primaReturnTrustedOriginV1(request) {
  const origin = request.headers.get('origin') || '';
  const hostname = new URL(request.url).hostname;

  if (!TRUSTED_UI_ORIGINS.has(origin)) return null;

  if (LOCAL_API_HOSTS.has(hostname)) {
    return ['http://localhost:4173', 'http://127.0.0.1:4173'].includes(origin)
      ? origin : null;
  }

  if (hostname === 'api-staging.primadom.ai') {
    return origin === 'https://prima-staging.primadom.ai' ? origin : null;
  }

  if (PROD_API_HOSTS.has(hostname)) {
    return origin === 'https://prima.primadom.ai' ? origin : null;
  }

  return null;
}

function cookieNameForRequest(request) {
  const url = new URL(request.url);
  if (LOCAL_API_HOSTS.has(url.hostname) && url.protocol === 'http:') {
    return 'prima_return_dev';
  }
  if (PROD_API_HOSTS.has(url.hostname) && url.protocol === 'https:') {
    return '__Host-prima_return';
  }
  return null;
}

function sessionSecret(env, request) {
  const hostname = new URL(request.url).hostname;
  const secret = env?.PRIMA_CONVERSATION_ACCESS_SECRET ||
    (LOCAL_API_HOSTS.has(hostname) ? env?.SUPABASE_SECRET_KEY : null);
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('return_session_secret_unavailable');
  }
  return secret;
}

async function signValue(env, request, conversationId, expiration) {
  const purpose = `PRIMA-RETURN-SESSION-V1\u0000${sessionSecret(env, request)}`;
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(purpose), {name:'HMAC',hash:'SHA-256'}, false, ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC',key,
    encoder.encode(`${conversationId}.${expiration}`)
  ));
  return btoa(String.fromCharCode(...signature))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}

export async function primaIssueReturnCookieV1(request,env,conversationId) {
  const cookieName = cookieNameForRequest(request);
  const id = String(conversationId || '').toLowerCase();
  if (!cookieName || !UUID.test(id) || !primaReturnTrustedOriginV1(request)) return null;
  const expiration = Math.floor(Date.now()/1000) + TTL_SECONDS;
  const signature = await signValue(env,request,id,expiration);
  const secure = cookieName.startsWith('__Host-') ? '; Secure' : '';
  return `${cookieName}=v1.${id}.${expiration}.${signature}; Max-Age=${TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export async function primaReadReturnSessionV1(request,env) {
  const cookieName = cookieNameForRequest(request);
  if (!cookieName || !primaReturnTrustedOriginV1(request)) return null;
  const cookies = String(request.headers.get('cookie') || '').split(';');
  const pair = cookies.map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`));
  if (!pair) return null;
  const value = pair.slice(cookieName.length+1);
  const match = /^v1\.([0-9a-f-]{36})\.([0-9]{10})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match || !UUID.test(match[1]) || !TOKEN.test(match[3])) return null;
  const now = Math.floor(Date.now()/1000);
  const exp = Number(match[2]);
  if (!Number.isSafeInteger(exp) || exp <= now || exp > now + TTL_SECONDS + 60) return null;
  const expected = await signValue(env,request,match[1].toLowerCase(), exp);
  let different = 0;
  for (let i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ match[3].charCodeAt(i);
  return different === 0 ? match[1].toLowerCase() : null;
}

export function primaCredentialedJsonV1(request,data,status=200,extraHeaders={}) {
  const origin = primaReturnTrustedOriginV1(request);
  if (!origin) return new Response(JSON.stringify({ok:false,error:'origin_not_allowed'}),{status:403,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  return new Response(JSON.stringify(data), {status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'private, no-store',
    'referrer-policy':'no-referrer',
    'access-control-allow-origin':origin,
    'access-control-allow-credentials':'true',
    'access-control-allow-headers':'content-type, authorization',
    'access-control-allow-methods':'GET,POST,OPTIONS',
    'vary':'Origin',
    ...extraHeaders
  }});
}

export function primaTrustedPreflightHeadersV1(request) {
  const origin = primaReturnTrustedOriginV1(request);
  return origin ? {
    'access-control-allow-origin':origin,
    'access-control-allow-credentials':'true',
    'access-control-allow-headers':'content-type, authorization',
    'access-control-allow-methods':'GET,POST,OPTIONS',
    'vary':'Origin'
  } : null;
}
