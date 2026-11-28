# PRIMA Routing QA — 30 тестов: подтверждённые дефекты и точечные исправления

**Источник:** все 3 полных JSON-отчёта из `PRIMA_ROUTING_30_FULL_EVIDENCE.zip` и текущие исходники.

**Routing verdict:** 22/30 PASS (73.3%), 6 FAIL, 2 REVIEW. **Не является процентом правильных ответов.**
**Уточнённая ручная оценка именно маршрутизации:** **25/30 (83,3%)** маршрутов допустимы, **4/30** имеют маршрутные отклонения (S15, S16, S24, S27), **1/30 REVIEW** (S09). Отличие от оригинальных 22 PASS: S04/S25 получили FAIL только из-за незавершённых фоновых трасс, а S08 — ложный FAIL тестового оценщика, потому что Luna законно вернула `decision=answer` для Persona без `next_action`. Это независимая экспертная переоценка на существующем журнале, не результат нового запуска.

**Контент:** 19/30 ответов содержали текст, 11/30 были поисковыми tool_request без финального ответа на первом этапе. По первичной проверке соответствия вопросу **не менее 9 из 19 текстовых ответов** явно не отвечают на существенную часть вопроса: S03, S14, S15, S16, S17, S18, S26, S27, S29. Остальные 10 нельзя объявлять фактически точными без проверки источников и требований; точность ответов **не измерена**.

**HTTP latency:** 20/30 измерены, среднее 8.87 с, медиана 7.69 с, максимум 19.15 с.
**Trace collection:** среднее 18.70 с, медиана 17.13 с; это не пользовательская задержка.
**Фактический текст ответа:** 19/30 обращений; 11/30 завершились `tool_request` и не имели финального пользовательского ответа на этом шаге. Оценки фактической достоверности ответов не проводилось.

## Что подтверждено и где исправляем

1. **S16 P0 — ложный CONTACT без разрешения**: `src/router.js::routeIntent` (контактные ключевые слова), `src/index.js::inspectPersonaContactConsentV1` (авторизация перед Policy), `src/decision-policy.js::decideNextActionV1` (`contact_intent → CONTACT`), `src/funnel.js::explicitHandoffRequest/evaluateFunnel`, `src/direct-contact-intent-h29.js::inspectDirectContactH29`. В текущем исходном тексте `not giving permission to contact me` не блокировалось как отрицание. Патч: отдельная проверка информационного вопроса/отрицания и явная граница авторизации CONTACT; без превращения отказа в постоянный opt-out.
2. **S15/S27 — информационные вопросы о контакте**: `router.js::routeIntent` и `index.js` до Decision Policy. `Luna → KNOWLEDGE_QA`, но `contact_intent/unsupported → CLARIFY`. Патч: когда текст явно просит объяснение и запрещает действие, сохранить информационный маршрут.
3. **S24 — ADVISORY ошибочно понижено до CLARIFY**: `src/decision-policy.js::decideNextActionV1` (`routeActions[page_question/market_question]` запрещали ADVISORY), затем `index.js::routeForNextActionV1`. Патч: разрешить высокоуверенное ADVISORY для объяснительных маршрутов, не трогая SEARCH и CONTACT.
4. **S14/S17 — выдуманная неоднозначность Dubai**: `src/entity-resolver.js::resolveNamedEntity` возвращает `ambiguous`, затем `src/index.js` формирует текст `I found more than one match for Dubai`. Патч: только для общих вопросов на page/market route трактовать `in Dubai` как географию, а не уникальный проект.

## Не исправлено в данном ZIP — отдельно исследовать

- **S04/S19:** `src/supabase.js::supabaseSelect` → HTTP 500 на `knowledge_registry_v1`; downstream `src/entity-resolver.js::resolveNamedEntity` бросал ошибку. `fetchReadWithRetry` повторяет только сетевые исключения, а не HTTP 500. Диагностика backend/запроса необходима до изменения ретраев.
- **S04/S25:** `INCOMPLETE_TIMEOUT` и несопоставленные spans: S04 — 10, S25 — 4. Это длительность завершения технической трассы, не время HTTP-ответа; root cause не доказана.
- **S08:** Luna вернула **`decision=answer` (корректная pure Persona ветка)**, а не ошибку. `next_action` там неприменим. Тестовый scorer неверно назвал её `other` и поставил FAIL; фактический финальный маршрут `persona_question`, действие `PERSONA`. **Исправить критерий QA, PRIMA-код по S08 не трогать.**
- **S03/S26/S29:** ответ заменяется общим сообщением про отсутствие живой статистики вместо определения или пояснения расходов; этот дефект относится к `src/local-responses.js` / Knowledge/Answer Selection, а не к сохранению маршрута.
- **S10/S19/S20:** выбор SEARCH не доказывает сохранение всех частей смешанного запроса; отдельно сверить `tasks[]` и tool contract.
- **S21/S22:** маршрут SEARCH выбран, но по сводке не доказано правильное применение исправленных bedroom/location в фильтрах.

## Весь набор: факты из журналов

| Test | QA | Входящий маршрут | Luna | Policy | Ответ / технический симптом |
|---|---|---|---|---|---|
| S01 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S02 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S03 | **PASS** | `market_question` | `KNOWLEDGE_QA` | `KNOWLEDGE_QA` | answer; — |
| S04 | **FAIL** | `page_question` | `KNOWLEDGE_QA` | `KNOWLEDGE_QA` | answer; INCOMPLETE_TIMEOUT; HTTP 500 knowledge_registry_v1 |
| S05 | **PASS** | `exact_fact` | `EXACT_FACT` | `EXACT_FACT` | answer; — |
| S06 | **PASS** | `recommendation` | `ADVISORY` | `ADVISORY` | answer; — |
| S07 | **PASS** | `compare` | `COMPARE` | `COMPARE` | answer; — |
| S08 | **FAIL** | `persona_question` | `other` | `PERSONA` | answer; — |
| S09 | **REVIEW** | `unsupported` | `ADVISORY` | `CLARIFY` | answer; — |
| S10 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S11 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S12 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S13 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S14 | **PASS** | `page_question` | `KNOWLEDGE_QA` | `KNOWLEDGE_QA` | clarification; — |
| S15 | **REVIEW** | `unsupported` | `KNOWLEDGE_QA` | `CLARIFY` | answer; — |
| S16 | **FAIL** | `contact_intent` | `ADVISORY` | `CONTACT` | answer; — |
| S17 | **PASS** | `page_question` | `KNOWLEDGE_QA` | `KNOWLEDGE_QA` | clarification; — |
| S18 | **PASS** | `recommendation` | `ADVISORY` | `ADVISORY` | answer; — |
| S19 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; COMPLETE; HTTP 500 knowledge_registry_v1 |
| S20 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S21 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S22 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S23 | **PASS** | `compare` | `COMPARE` | `COMPARE` | answer; — |
| S24 | **FAIL** | `page_question` | `ADVISORY` | `CLARIFY` | answer; — |
| S25 | **FAIL** | `page_question` | `KNOWLEDGE_QA` | `KNOWLEDGE_QA` | answer; INCOMPLETE_TIMEOUT |
| S26 | **PASS** | `market_question` | `KNOWLEDGE_QA` | `KNOWLEDGE_QA` | answer; — |
| S27 | **FAIL** | `unsupported` | `KNOWLEDGE_QA` | `CLARIFY` | answer; — |
| S28 | **PASS** | `property_search` | `SEARCH` | `SEARCH` | tool_request; — |
| S29 | **PASS** | `market_question` | `KNOWLEDGE_QA` | `KNOWLEDGE_QA` | answer; — |
| S30 | **PASS** | `page_question` | `KNOWLEDGE_QA` | `KNOWLEDGE_QA` | answer; — |

## Правило использования

Патч не развёрнут на Mac и не проходил live Worker QA. 39 локальных тестов проверяют только чистую маршрутизацию, consent guards и Policy. После установки нужно точечно перепроверить S14, S15, S16, S17, S24, S27, а также положительные контактные сценарии.

ZIP не изменяет файлы при распаковке: `install.py --check` сверяет SHA; `--apply` создаёт backups, применяет ровно 5 изменённых модулей и новый helper, затем запускает локальные тесты. Другие исходники в архиве приложены для удобства и не перезаписываются.
