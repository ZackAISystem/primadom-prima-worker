# Prima AI — Day 2 Open Dependencies

## 1. Payment Plan dataset

Current state:
Payment-plan data does not currently exist on any Primadom page.

Temporary runtime policy:
- deterministic unavailable response
- zero database calls
- zero OpenAI calls
- never infer payment plan from price, status, handover or other facts

Required when payment-plan data becomes available:
1. Remove the global payment-plan no-knowledge bypass.
2. Enable structured `payment_plan` retrieval.
3. Return verified payment-plan data when present.
4. Keep the unavailable guard only for individual projects where data is missing.
5. Re-run exact_fact and hallucination QA.
6. Re-run latency QA.
7. Update this dependency status to CLOSED.

## 2. Live market data

Current state:
Existing market-oriented knowledge candidates are marked as requiring live sources.

Temporary runtime policy:
- no invented current market statistics
- Market Guard returns a safe response
- zero OpenAI calls when verified live market evidence is unavailable

Required later:
Connect a verified/current market data layer, then enable market retrieval + reasoning.

## 3. Cold-path latency

Hard Prima response SLA:
<= 2.0 seconds.

Current warm paths pass.
Some first/cold requests can exceed 2.0 seconds.

Day 3:
- prewarm / connection strategy
- cold-path QA
- edge/cache optimisation if required

## 4. Prima Personality V1

Technical persona hooks currently exist only as a provisional draft.

Status:
PENDING PRODUCT REVIEW.

Before final Day 2 freeze:
- identity
- capabilities
- restrictions
- tone
- uncertainty rules
- commercial behaviour
- advisor handoff
- restricted topics

`contracts/prima-persona-v1.json` must not be treated as approved until this review is complete.
