#!/usr/bin/env python3
"""PRIMA QA trace R2.24.17: fail-closed, idempotent, exact source patches."""
from pathlib import Path
import subprocess, sys, hashlib, json, time
R=Path.cwd()
assert (R/'src/index.js').exists() and (R/'qa/full-pipeline/runners/source-fingerprint.py').exists(), 'Run in PRIMA Worker repo'
IDX=R/'src/index.js'; SB=R/'src/supabase.js'
original={p:p.read_text(encoding='utf8') for p in (IDX,SB)}
marker='PRIMA_QA_RUNTIME_TRACE_R22417'
if marker in original[IDX] and marker in original[SB]:
    print('ALREADY INSTALLED — source untouched')
    sys.exit(0)
if marker in original[IDX] or marker in original[SB]:
    raise SystemExit('ABORT: partial installation detected; no changes made')
idx=original[IDX]; sb=original[SB]
def once(text,needle,replacement,desc):
    count=text.count(needle)
    if count!=1: raise RuntimeError(f'ABORT {desc}: expected 1 anchor, found {count}')
    return text.replace(needle,replacement,1)
# Exact patches do not change execution paths, only opt-in telemetry.
needle='''        const d0Emit = stage => {
          if (d0Trace) console.info("PRIMA_V12_TURN_TRACE", JSON.stringify({...d0Trace,stage}));
        };'''
replacement=needle+'''
        // PRIMA_QA_RUNTIME_TRACE_R22417: local-only diagnostics, no user text/PII.
        const qaActive = env?.PRIMA_QA_RUNTIME_TRACE === "1";
        const qaTraceId = qaActive ? crypto.randomUUID() : null;
        const qaStart = Date.now();
        const qaEnum = (x, values) => values.includes(x) ? x : "other";
        const qaEmit = (stage, details = {}) => {
          if (!qaActive) return;
          console.info("PRIMA_QA_TRACE", JSON.stringify({
            version:"R2.24.17", trace_id:qaTraceId, stage,
            elapsed_ms:Date.now()-qaStart,
            turn_seq:Number.isInteger(turn?.turn_seq) ? turn.turn_seq : null,
            phase: turn?.phase === "tool_continuation" ? "tool_continuation" : "initial",
            ...details
          }));
        };
        qaEmit("turn_begin", {module:"src/index.js", fn:"fetch", 
          search_context_present:Boolean(body?.search_context)});'''
idx=once(idx,needle,replacement,'qa bootstrap')
needle='''          const lunaPlanV12 = lunaUnderstandingV12?.interpretation?.luna_decision ||'''
replacement='''          qaEmit("luna_result", {
            module:"src/persona-semantic-a1.js",fn:"generate",
            decision:qaEnum(lunaUnderstandingV12?.decision,["route","answer","delegate","error"]),
            primary_route:qaEnum(lunaUnderstandingV12?.interpretation?.primary_route,d0Routes),
            next_action:qaEnum(lunaUnderstandingV12?.interpretation?.luna_decision?.next_action ||
              lunaUnderstandingV12?.luna_decision?.next_action,d0Actions),
            tasks_count:Array.isArray(lunaUnderstandingV12?.interpretation?.tasks)
              ? lunaUnderstandingV12.interpretation.tasks.length : null,
            confidence:Number.isFinite(lunaUnderstandingV12?.interpretation?.overall_confidence)
              ? lunaUnderstandingV12.interpretation.overall_confidence : null,
            duration_ms:Number.isFinite(lunaUnderstandingV12?.latency_ms)
              ? lunaUnderstandingV12.latency_ms:null,
            input_tokens:lunaUnderstandingV12?.usage?.input_tokens ?? null,
            output_tokens:lunaUnderstandingV12?.usage?.output_tokens ?? null,
            error_code:qaEnum(lunaUnderstandingV12?.error_code,
              ["timeout","invalid_semantic_output","unsafe_persona_answer",
              "invalid_delegation","provider_http_failure","unparseable_model_output","other_a1_failure"])
          });
          const lunaPlanV12 = lunaUnderstandingV12?.interpretation?.luna_decision ||'''
idx=once(idx,needle,replacement,'luna')
needle='''        if (h29Direct.direct_request) route = "contact_intent";

        // MEM02:'''
replacement='''        if (h29Direct.direct_request) route = "contact_intent";
        qaEmit("router", {module:"src/router.js",fn:"routeIntent",
          route:qaEnum(route,d0Routes)});

        // MEM02:'''
idx=once(idx,needle,replacement,'router')
needle='''        // Block A: mixed buyer intent is not a zero-token Persona turn.'''
replacement='''        qaEmit("fast_gate", {module:"src/fast-gate.js",fn:"evaluateFastGate",
          route:qaEnum(route,d0Routes),
          kind:qaEnum(fastGate?.kind,["route","persona","fact","clarification","search","contact","none"]),
          gated:Boolean(fastGate?.gate || fastGate?.blocked)});
        // Block A: mixed buyer intent is not a zero-token Persona turn.'''
idx=once(idx,needle,replacement,'fast gate')
needle='        const nextAction = finalizeNextActionV12({'
replacement='        qaEmit("interpreter", {module:"src/request-interpreter.js",fn:"interpretRequest",\n          attempted:Boolean(interpreterCallAttempted),\n          disposition:qaEnum(interpreterResult?.decision,["route","answer","clarify","error"]),\n          tasks_count:Array.isArray(resolvedTasks)?resolvedTasks.length:null});\n        qaEmit("conversation_move", {module:"src/conversation-move.js",fn:"protectTopicMoveV1",\n          move:qaEnum(conversationMove?.move_type,\n            ["new_thread","switch","suspend","resume","refinement","continuation","reference","none"]),\n          effective_route:qaEnum(conversationMove?.effective_route,d0Routes)});\n        const nextAction = finalizeNextActionV12({'
idx=once(idx,needle,replacement,'interpreter and conversation move')
needle='''        if (d0Trace) {
          d0Trace.pre_policy_route = d0Enum(route, d0Routes);'''
replacement='''        qaEmit("decision_policy", {module:"src/decision-policy.js",
          fn:"finalizeNextActionV12",route_before:qaEnum(route,d0Routes),
          candidate:qaEnum(policyCandidateV12?.action,d0Actions),
          final_action:qaEnum(nextAction?.action,d0Actions),
          reason:qaEnum(nextAction?.reason,[
            "luna_validated_semantic_action_v12","explicit_persona_route",
            "conversation_reference","pure_semantic_profile_update",
            "unresolved_request_clarification","verified_fact_route",
            "property_search_route","comparison_route","advisory_route",
            "contact_route","semantic_request_unresolved","knowledge_question_route",
            "open_conversation_follow_up","clarification_route",
            "no_actionable_route","unknown_route_safe_fallback",
            "resumed_conversation_context_reference","semantic_action_not_accepted",
            "verified_compound_relationship_search_r24"])});
        if (d0Trace) {
          d0Trace.pre_policy_route = d0Enum(route, d0Routes);'''
idx=once(idx,needle,replacement,'policy')
needle='''        if (d0Trace) d0Trace.executor_route = d0Enum(route, d0Routes);'''
replacement='''        qaEmit("executor_route", {module:"src/index.js",fn:"routeForNextActionV1",
          route:qaEnum(route,d0Routes),action:qaEnum(nextAction?.action,d0Actions)});
        if (d0Trace) d0Trace.executor_route = d0Enum(route, d0Routes);'''
idx=once(idx,needle,replacement,'executor')
needle='''            d0Emit("tool_request");
          }
          return json({
            ...primaSearchRequest,'''
replacement='''            d0Emit("tool_request");
          }
          qaEmit("search_dispatch", {module:"src/prima-search-request.js",
            fn:"buildPrimaSearchRequest",executor:"prima_search",
            checkpoint:pendingStateSavedV12 === true ? "saved" :
              pendingStateSavedV12 === false ? "failed" : "not_required"});
          return json({
            ...primaSearchRequest,'''
idx=once(idx,needle,replacement,'search dispatch')
needle='''        const knowledgeTask =
          needsKnowledge'''
replacement='''        qaEmit("knowledge_plan", {module:"src/knowledge.js",fn:"resolveKnowledge",
          needs_knowledge:Boolean(needsKnowledge),
          needs_search_knowledge:Boolean(needsSearchKnowledge),
          has_search_results:contextEnvelope?.search?.state === "results"});
        const knowledgeTask =
          needsKnowledge'''
idx=once(idx,needle,replacement,'knowledge')
needle='''        if (f213Recommendation) evidencePack.f213_recommendation = f213Recommendation;'''
replacement='''        if (f213Recommendation) evidencePack.f213_recommendation = f213Recommendation;
        qaEmit("evidence", {module:"src/evidence-pack.js",fn:"buildEvidencePack",
          source_count:Number(evidencePack?.meta?.source_count || 0),
          has_knowledge:Boolean(knowledgePack),
          has_search_results:contextEnvelope?.search?.state === "results"});'''
idx=once(idx,needle,replacement,'evidence')
needle='''        // G43_GENERATED_CTA_VALIDATION_V1'''
replacement='''        qaEmit("answer_model", {module:"src/openai-reasoning.js",fn:"generatePrimaAnswer",
          attempted:Boolean(useOpenAI),answered:Boolean(openAIResult?.answer),
          latency_ms:openAIResult?.latency_ms ?? null,
          input_tokens:openAIResult?.usage?.input_tokens ?? null,
          output_tokens:openAIResult?.usage?.output_tokens ?? null});
        // G43_GENERATED_CTA_VALIDATION_V1'''
idx=once(idx,needle,replacement,'model answer')
needle='''          const baseAnswer =
            contactDecision'''
replacement='''          qaEmit("answer_selection", {module:"src/index.js",fn:"answer_selection",
            source:d0Trace?.final_source || (localAnswer ? "local" :
              structuredAnswer?.answer ? "structured" :
              openAIResult?.answer ? "openai_composer" :
              fallbackAnswer ? "grounded_fallback" : "other"),
            evidence_present:Number(evidencePack?.meta?.source_count || 0)>0});
          const baseAnswer =
            contactDecision'''
idx=once(idx,needle,replacement,'answer selection')
needle='''          d0Emit("final_response");
        }
        responsePayload.meta.persona_a1_before_model_ms'''
replacement='''          d0Emit("final_response");
        }
        qaEmit("final_response", {module:"src/index.js",fn:"fetch",
          route:qaEnum(route,d0Routes),response_type:qaEnum(responsePayload?.response_type,
            ["answer","clarification","tool_request","lead_transition","recommendation","search_results","error"]),
          action:qaEnum(nextAction?.action,d0Actions),
          used_search:Boolean(responsePayload?.meta?.used_search),
          worker_ms:responsePayload?.meta?.worker_total_ms ?? null});
        responsePayload.meta.persona_a1_before_model_ms'''
idx=once(idx,needle,replacement,'final')
# Database transport tracing, no payload, no secrets, local QA only. Strong deny leads.
needle='''function headers(env) {'''
replacement='''// PRIMA_QA_RUNTIME_TRACE_R22417 — Opt-in transport envelope only.
async function qaSupabaseFetch(env, url, options) {
  if (env?.PRIMA_QA_RUNTIME_TRACE !== "1") return fetch(url,options);
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
    const result=await fetch(url,options);
    console.info("PRIMA_QA_TRACE",JSON.stringify({version:"R2.24.17",
      stage:"supabase_http",module:"src/supabase.js",fn:"qaSupabaseFetch",
      operation:rpc || table || "unknown",method,status:result.status,
      duration_ms:Date.now()-started}));
    return result;
  } catch (error) {
    console.info("PRIMA_QA_TRACE",JSON.stringify({version:"R2.24.17",
      stage:"supabase_http",module:"src/supabase.js",fn:"qaSupabaseFetch",
      operation:rpc || table || "unknown",method,status:"network_error",
      duration_ms:Date.now()-started}));
    throw error;
  }
}

function headers(env) {'''
sb=once(sb,needle,replacement,'db trace helper')
needle='''async function fetchReadWithRetry(
  url,
  options
) {'''
replacement='''async function fetchReadWithRetry(
  url,
  options,
  env = null
) {'''
sb=once(sb,needle,replacement,'read helper signature')
# Every fetch call in this file is either direct with env or inside retry helper.
sb=sb.replace('await fetch(\n','await qaSupabaseFetch(\n        env,\n')
# The replacement only matches the calls with line-break; check it inserted every expected call.
if sb.count('await qaSupabaseFetch(')!=7: raise RuntimeError(f'ABORT transport call coverage: {sb.count("await qaSupabaseFetch(")} expected 7')
# Propagate env through three callers by targeted endings.
for end in ['''        headers: headers(env)
      }
    );''','''          JSON.stringify(payload)
      }
    );''']:
    pass
# three calls have identical closing, replace in read functions only between their signatures.
start=sb.index('export async function supabaseSelect(')
segment=sb[start:]
segment=segment.replace('''      }
    );''','''      }, env
    );''',3)
if segment.count('}, env\n    );')!=3:raise RuntimeError('ABORT read retry callsites')
sb=sb[:start]+segment
# Confirm syntax before modifying original files.
tmp=R/'qa/full-pipeline/instrumentation'; tmp.mkdir(parents=True,exist_ok=True)
for name,content in [('index.mjs',idx),('supabase.mjs',sb)]:
    check=subprocess.run(['node','--input-type=module','--check'],input=content,text=True,capture_output=True)
    if check.returncode:raise RuntimeError(f'ABORT syntax {name}: {check.stderr[-1000:]}')
# No backs up outside QA: backup only 2 originals stored under QA instrumentation, not executed.
stamp=str(int(time.time()))
backup=tmp/f'rollback-{stamp}'
backup.mkdir()
for p,txt in original.items(): (backup/p.name).write_text(txt,encoding='utf8')
try:
    IDX.write_text(idx,encoding='utf8'); SB.write_text(sb,encoding='utf8')
except Exception:
    for p,txt in original.items():p.write_text(txt,encoding='utf8')
    raise
print('INSTALLED PRIMA R2.24.17 runtime trace')
print('MODIFIED (LOCAL ONLY): src/index.js, src/supabase.js')
print('ROLLBACK:',backup.relative_to(R))
print('NO DEPLOY / NO DATABASE CALLS / NO SOURCE COPIES EXECUTED')
