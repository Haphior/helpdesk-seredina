# ADR 0005: AI copilot v1 — suggest-reply and summarize

## Status

Accepted, implemented. Copilot mode only — see "What wasn't verified" below for a
real limitation this pass shipped with, not silently.

## Context

AI integration has been part of Seredina's pitch since Phase 0 (`packages/
ai-adapters` was scaffolded as an empty placeholder then) but never actually
built — Phase 1's original scope listed "AI copilot v1" and it stayed unbuilt
through email channel, CMDB, alert ingestion, multi-user tenants, the UI redesign,
and the security hardening pass. This closes that gap: the smallest real AI
feature that's still genuinely useful — an agent can ask the model to draft a
reply or summarize a thread, review it, and decide whether to use it. Nothing
sends or changes ticket state on its own.

## Decisions

**`LlmProviderAdapter` interface (`packages/ai-adapters`), Anthropic first.**
`complete({system, messages, maxTokens}) -> {text, inputTokens, outputTokens}` is
the entire surface. `apps/api`'s AI routes/service only ever depend on this
interface, never on `@anthropic-ai/sdk` directly — swapping or adding a provider
(Phase 3's plan already names a second one, to prove the abstraction isn't
Anthropic-shaped) touches `AnthropicAdapter` alone. A `TestProviderAdapter` (queued
responses, records every call) is the other implementation, used by
`apps/api/test/ai-suggest-reply.test.ts` — no network access in the test suite.

**Copilot only, not autonomous.** `suggestReply`/`summarizeTicket` return text to
the agent; nothing is written to the ticket or sent to the customer
automatically. This is deliberate, not a v1-only shortcut — the original pitch's
three AI modes (copilot, autonomous, open MCP framework) put "suggests, human
approves" as the default posture, with autonomous mode gated behind a
per-tenant `AutonomyPolicy` that doesn't exist yet (Phase 3). Building
suggest-only first means the trust-sensitive auto-execution design isn't rushed
to ship something demoable now.

**Private notes are excluded from every prompt.** `loadTicketThread` in
`modules/ai/service.ts` filters `isPrivateNote` messages before building the
conversation the model sees, for both suggest-reply and summarize. This isn't
optional or configurable — an internal note (which can contain things like "this
customer is on a known-buggy build, don't mention the CVE number") must never be
able to leak into an AI-drafted reply that's headed back to that same customer.
Verified with an automated test, not just code review: a real ticket thread with
an internal note containing a distinctive marker string, asserting the string
never appears in what got sent to the (test) provider.

**Graceful absence, not a hard requirement.** `getAiAdapter()` returns `null` when
`ANTHROPIC_API_KEY` is unset — routes turn that into a `503`, the web UI shows the
message inline without breaking the rest of the ticket page. Same pattern as
error tracking (ADR-less, but see `docs/ROADMAP.md`'s security-hardening entry)
and email channels: an optional feature degrades, it doesn't take the whole
deployment down or force every self-hoster to have an Anthropic account.

**Model default `claude-opus-5`, overridable via `ANTHROPIC_MODEL`.** Per current
guidance, always default to the flagship model unless told otherwise — but this
is a per-ticket feature that can fire often across a whole deployment, unlike a
one-off task, so a self-hosted operator watching their own API bill needs a way
to point it at a cheaper/faster model without a code change.

**Extended thinking explicitly disabled** (`thinking: {type: 'disabled'}`), not
left adaptive. Suggest-reply and summarize are real-time UI actions — an agent
clicks a button and waits — not open-ended reasoning tasks; adaptive thinking's
latency tradeoff doesn't pay for itself here the way it might for something like
the planned RAG/autonomous-mode tool use in Phase 3.

**Gated on `tickets:write`**, the same permission that gates actually sending a
reply — suggesting one is a lighter version of the same action, never something
a read-only agent should be able to trigger.

## What wasn't verified

No Anthropic API key was available in this environment this session. Verified
for real: the `TestProviderAdapter` path end to end against a live Postgres
(prompt construction, private-note exclusion, ticket-not-found handling — 3
passing tests), and the real HTTP path's graceful-absence behavior (a real `curl`
against the running API returns the correct `503` with no key set, and the web
UI renders that inline without breaking). **Not verified**: an actual live call
from `AnthropicAdapter` to the real Anthropic API has never been exercised — the
request/response shape is written directly from the current `@anthropic-ai/sdk`
API (confirmed via the claude-api skill and the installed package's type
definitions, not from training-data memory), but "compiles against the SDK's
types" and "actually works against the live API" are different claims. Treat
`AnthropicAdapter` as reviewed-but-unexercised until someone runs it with a real
key; if it needs a fix at that point, it wouldn't be the first time this project
found something only a real external system could catch (see ADR 0004's IMAP
STORE-during-FETCH bug).

## Consequences / known v1 limitations

- No RAG/knowledge-base grounding yet (Phase 3) — the model only sees the
  ticket's own thread, nothing from a KB.
- No `AiAgentRun` audit trail yet — a suggestion that gets used leaves no
  separate record that AI was involved beyond the agent's own edited reply.
  Worth adding once autonomous mode (Phase 3) makes an audit trail load-bearing
  rather than just nice-to-have.
- No token/cost caps per tenant — a self-hosted operator's own Anthropic bill is
  currently unbounded by anything Seredina enforces. Same category of gap as
  Phase 3's planned `AutonomyPolicy` action caps, not yet built for this
  narrower copilot-only feature either.
- Suggest-reply and summarize each make a fresh, independent model call — no
  caching, no shared context between the two if an agent clicks both on the same
  ticket.
