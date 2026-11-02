/*
 * Block I31 — Recover original service request when final contact turn
 * contains only email/phone. Work only within the already-authorized
 * conversation. Never store raw contact messages or infer marketing consent.
 * Verify explicitly mentioned projects in the existing canonical Registry.
 */
import { supabaseSelect } from "./supabase.js";
import { resolveNamedEntity } from "./entity-resolver.js";

const clean = value => String(value ?? "").trim();
const short = value => clean(value).slice(0, 150);

function serviceFromText(message) {
  const s = clean(message);
  if (/\b(?:viewing|view|visit|tour|show(?:ing)?\s+(?:apartment|unit|property)|site\s+visit)\b/i.test(s)) return "viewing";
  if (/\b(?:availability|available|stock|vacant)\b/i.test(s)) return "availability_check";
  if (/\b(?:payment\s+plan|purchase\s+terms|installments?|financing\s+terms)\b/i.test(s)) return "purchase_terms";
  if (/\b(?:investment|invest|rental\s+yield|returns?|roi)\b/i.test(s)) return "investment_consultation";
  return "general_contact";
}

function isExplicitContactRequest(message) {
  const s = clean(message);
  if (/\b(?:do\s+not|don't|never|please\s+not)\b[\s\S]{0,100}\b(?:contact|email|call|message|reach)\s+me\b/i.test(s)) return false;
  if (/\b(?:contact|email|call|message|whatsapp|reach)\s+me\b/i.test(s) &&
      /\b(?:please|can|could|would|ask|need|want|like|help)\b/i.test(s)) return true;
  if (/\b(?:connect\s+me|put\s+me\s+in\s+touch|have\s+(?:an?\s+)?(?:agent|advisor|specialist)|ask\s+someone|your\s+team)\b/i.test(s) &&
      /\b(?:please|can|could|would|contact|email|call|message|reach|arrange)\b/i.test(s)) return true;
  return false;
}

// This extractor only proposes names. Nothing is stored until Registry
// verifies exactly one canonical project. It never resolves by guesswork.
export function projectCandidateI31(message) {
  const s = clean(message);
  // I34: cut at a *communication action*, not at "and" indiscriminately.
  // "viewing of Passo and contact me by email" means project=Passo.
  // The extracted candidate still MUST match the canonical Registry exactly.
  let m = s.match(/\b(?:viewings?|visits?|tours?|showing)\s+(?:at|to|of|for)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 &'’.-]{1,99}?)(?=\s+and\s+(?:(?:please|kindly)\s+)?(?:contact|email|call|message|whatsapp|reach)\s+me\b|[?!,;:]|$)/i);
  if (!m) m = s.match(/\b(?:contact|email|call|message|reach)\s+me\s+about\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 &'’.-]{1,99})(?=[?!,;:]|$)/i);
  if (!m) return null;
  const candidate = short(m[1]).replace(/\s+(?:please|next\s+week|next\s+month|tomorrow|today)\s*$/i,"").replace(/[\s.,;:!?]+$/g,"").trim();
  if (!candidate || candidate.split(/\s+/).length > 8 ||
      /^(?:a|an|the|some|any|new)\s+(?:project|property|apartment|villa|unit)/i.test(candidate) ||
      /\b(?:my|your|contact|email|phone|whatsapp)\b/i.test(candidate)) return null;
  return candidate;
}

export function deriveHandoffI31(messages=[], currentMessage="") {
  // Recent messages are oldest -> newest, but only the most recent actual
  // human contact request establishes the current service. A contact-only
  // continuation cannot erase the earlier viewing/availability request.
  const items = (Array.isArray(messages) ? messages : [])
    .filter(row => row?.role === "user" && typeof row?.content === "string")
    .map(row => row.content)
    .slice(-12);
  items.push(clean(currentMessage));
  for (let i=items.length-1; i>=0; i--) {
    const text=items[i];
    if (!isExplicitContactRequest(text)) continue;
    return {
      requested_service: serviceFromText(text),
      candidate_name: projectCandidateI31(text),
      contact_request_evidence: {
        source:"user_explicit_request",
        scope:"requested_service_follow_up",
        // No raw messages, PII, or implicit marketing opt-in.
        marketing_consent_claimed:false
      }
    };
  }
  return {requested_service:serviceFromText(currentMessage),
    candidate_name:null,contact_request_evidence:null};
}

export async function prepareLeadHandoffContextI31({env,conversationId,currentMessage,context}={}) {
  if (!env || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(conversationId||""))) return null;
  let messages = Array.isArray(context?.conversation?.recent_messages)
    ? context.conversation.recent_messages : [];
  // Fast contact paths often hydrate only conversation state, not messages.
  if (!messages.length) {
    try {
      messages=await supabaseSelect(env,"messages",
        `conversation_id=eq.${encodeURIComponent(conversationId)}&role=eq.user&select=role,content,created_at&order=created_at.desc&limit=12`);
      // Context contract expects chronological order; the DB query uses DESC
      // only to select the most recent 12 rather than the first 12 ever.
      messages=(messages||[]).reverse();
    } catch {
      // Failure of enrichment must not claim a project or reveal PII.
      messages=[];
    }
  }
  const derived=deriveHandoffI31(messages,currentMessage);
  let verified_subject=null;
  if (derived.candidate_name) {
    try {
      const resolved=await resolveNamedEntity({env,
        candidate:{type:"project",name:derived.candidate_name,role:"primary",source:"i31_contact_request"},
        // Do not let ambient page skip the canonical lookup.
        context:{page:{language_code:"en"},entity:{}},route:"page_question"});
      if (resolved?.resolved && resolved?.status==="exact" &&
          resolved.page?.primary_entity_type==="project" &&
          resolved.page?.page_type_id==="project_page" &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(resolved.page?.primary_entity_slug || ""))) {
        verified_subject={entity_type:"project",entity_slug:resolved.page.primary_entity_slug,
          registry_page_id:resolved.page.page_id,source:"canonical_registry"};
      }
    } catch {
      verified_subject=null;
    }
  }
  return {
    requested_service:derived.requested_service,
    verified_subject,
    contact_request_evidence:derived.contact_request_evidence
  };
}
