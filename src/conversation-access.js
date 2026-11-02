// H-SECURITY-V1: stateless, conversation-scoped bearer capability.
// Token is derived server-side and never stored in frontend storage.
const encoder = new TextEncoder();
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signatureBytes(env, conversationId) {
  const secret = env?.PRIMA_CONVERSATION_ACCESS_SECRET || env?.SUPABASE_SECRET_KEY;
  if (typeof secret !== "string" || secret.length < 32 || !UUID_RE.test(String(conversationId || ""))) {
    throw new Error("conversation_access_unavailable");
  }
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode("PRIMA-H-ACCESS-V1\0" + secret),
    {name:"HMAC", hash:"SHA-256"}, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(String(conversationId).toLowerCase())));
}

export async function issueConversationAccessToken(env, conversationId) {
  const sig = await signatureBytes(env, conversationId);
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function verifyConversationAccess(request, env, conversationId) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "");
  if (!match || !TOKEN_RE.test(match[1])) return false;
  try {
    const expected = await issueConversationAccessToken(env, conversationId);
    // Equal-length constant-time comparison; never log credentials.
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ match[1].charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}
