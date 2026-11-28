# PRIMA Routing QA — Focused Fix R1

Здесь не новый Router, не новый Search и не переписывание PRIMA.

ЧТО МЕНЯЕТСЯ:
- src/router.js
- src/index.js
- src/decision-policy.js
- src/funnel.js
- src/direct-contact-intent-h29.js
- NEW src/contact-routing-safety-v1.js

Остальные файлы в patched/src включены только как копии оригиналов из переданного ZIP. Установщик их НЕ перезаписывает.

СТАТУС:
39 local static / pure-function QA: PASS.
Live Worker routing QA after patch: NOT RUN.
Quality of final answers: NOT SCORED.

ПЕРЕД УСТАНОВКОЙ: git status / локальный бэкап желательны.

Установить пакет в корне primadom-prima-worker:
  unzip -o "$HOME/Downloads/PRIMA_ROUTING_30_FOCUSED_FIX_R1.zip"

Без изменений, только сверка исходников:
  python3 qa/full-pipeline/routing-fix-r1/install.py --check

Локальное безопасное применение с бэкапом и тестами:
  python3 qa/full-pipeline/routing-fix-r1/install.py --apply

При несовпадении SHA установка блокируется до правки актуального source.
Ни Supabase, ни LLM, ни Wrangler, ни deploy на этапе установки не используются.

ПРОБЛЕМЫ ВНЕ ЭТОГО ПАКЕТА:
S04/S19 500 knowledge_registry_v1; S04/S25 async pending spans;
S08 semantic Persona; S03/S26/S29 inadequate generic answer;
полная проверка SEARCH-фильтров и сохранения mixed tasks.

См. ROUTING_30_FINDINGS_AND_FIXES.md.
