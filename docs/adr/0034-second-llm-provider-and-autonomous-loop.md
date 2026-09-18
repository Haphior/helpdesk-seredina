# ADR 0034: Second LLM provider (OpenAI + local Ollama) and the autonomous tool-use loop

## Status

Accepted, implemented.

## Context

Two roadmap items remained from Phase 3 after ADR 0033: "a second LLM
provider adapter to validate the adapter abstraction is provider-agnostic"
and "a full autonomous copilot loop (an actual `adapter.complete()` tool-use
loop deciding which tools to call, not just [ADR 0033's] human-invoked-via-
MCP gate)." The user asked for both together, with one explicit steer: don't
just add a second cloud provider — add a genuinely free, private, no-API-key
local option too, so a self-hosted operator has real choices, not just a
choice of which company to send data to.

## Decisions

### Provider choice: `AI_PROVIDER` env var, three options

`apps/api/src/modules/ai/adapter.ts`'s `getAiAdapter()` now reads
`AI_PROVIDER` (`'anthropic' | 'openai' | 'ollama'`). Unset falls back to the
pre-existing behavior (Anthropic if `ANTHROPIC_API_KEY` is set) so an
existing self-hosted `.env` keeps working unchanged. An unrecognized value
disables AI and logs why, rather than throwing and turning every AI route
into a 500 over one misconfigured env var — the same "optional feature,
never crashes the request path" posture `getAiAdapter()` already had.

### `OpenAIAdapter` — real API research, not recalled training data

Rather than trust memory of OpenAI's SDK (which drifts across versions), the
`openai` npm package was installed and its actual `.d.ts` files read
directly: confirmed `max_completion_tokens` is the current field
(`max_tokens` is deprecated), confirmed the response shape
(`choices[0].message.content: string | null`,
`usage.prompt_tokens`/`completion_tokens`), and confirmed the SDK's own
`fetch` constructor option — the seam `openaiAdapter.test.ts` uses to verify
real request/response shapes without a network call or a real key (none is
available in this environment). Pinned to `openai@^6.x`, not the just-released
`7.x`, specifically because `7.x` requires Node ≥22 and this codebase targets
Node 20 — confirmed by checking `engines` across versions rather than hitting
an install failure and guessing why.

### `OllamaAdapter` — the actual local option, verified live

Ollama's own docs (fetched, not recalled) confirm its OpenAI-compatibility
layer: base URL is the host's own `/v1`, and the API key is "required, but
unused" (`'ollama'` as a placeholder satisfies the SDK's type, nothing more).
Reuses the `openai` package as its HTTP client — Ollama deliberately mirrors
the Chat Completions wire format, so a second hand-rolled HTTP client would
have been pure duplication. Every model name it returns is prefixed
`ollama:` (e.g. `ollama:qwen2.5-coder:7b`), which `pricing.ts`'s
`estimateCostUsd` recognizes to report a real **$0**, not the same unpriced
`null` a genuinely-unrecognized cloud model would get — this environment's
own sandbox happened to have Ollama already running with a model pulled,
and the real `AiUsageLog` row this produced (see Verified) confirmed that
distinction actually renders correctly, not just in theory.

This sandbox's Ollama instance is real, not staged for this ADR — it was
discovered already running (`ollama` binary present, `qwen2.5-coder:7b`
already pulled) while researching what a genuine local option would need,
and every Ollama-related claim below was checked against it directly.

### The `LlmProviderAdapter` interface grew tool-use support

Copilot's existing calls (`suggestReply`/`summarizeTicket`) only ever send
plain text messages and expect plain text back — that stays true and
untouched. But an autonomous loop needs the model to request tool calls and
receive their results across multiple turns, and that shape didn't exist
yet. Added, provider-agnostically:

- `ToolSpec { name, description, inputSchema: JSON Schema }` — plain JSON
  Schema, not zod: `packages/ai-adapters` has no zod dependency and
  shouldn't need one just to describe a tool's shape. The conversion from a
  catalog tool's real zod `argsSchema` to JSON Schema happens once, in
  `apps/api`, via `zod-to-json-schema` — not inside this package.
- `LlmMessage` became a union: plain user/assistant text (copilot's existing
  case), an assistant turn requesting `toolCalls`, and a `tool_results` turn
  reporting what those tools returned.
- `CompleteResult` gained `stopReason` (`'end_turn' | 'tool_use' |
  'max_tokens'`) and an optional `toolCalls`.

Each adapter translates this generic shape into its own real wire format,
checked against the actual SDK types, not guessed:

- **Anthropic**: block-based even for plain text — a tool-call turn becomes
  `tool_use` content blocks, and a `tool_results` turn becomes a *user*
  message of `tool_result` blocks (Anthropic has no separate "tool" role).
- **OpenAI/Ollama** (identical wire format, one shared `toOpenAiMessages`
  helper): a tool-call turn is an assistant message with a `tool_calls`
  array; each tool result is its **own** message with `role: 'tool'` — a
  real difference from Anthropic worth calling out, since it's the kind of
  detail that's easy to get wrong translating between the two.

`TestProviderAdapter` gained the ability to script a `toolCalls` response
(not just plain text), which is what makes the autonomous loop's own test
suite fully deterministic — no network, no real model, and no flakiness
from a local model's own unpredictability (see the next section for why that
matters).

### The autonomous loop: one gate, reused, not a parallel implementation

`apps/api/src/modules/ai-tools/autonomousLoop.ts`'s `runAutonomousLoop`
builds the tool catalog's JSON schemas once, then loops: call the adapter
with the tool specs, and if it asks for tool calls, run each one through
**the exact same `runTool()` executor ADR 0033 built for MCP** — with
`source: 'autonomous'` instead of `'mcp'` so the activity log can tell them
apart — feed the results back, and repeat. This is the whole point of
building the gate as a single shared executor in ADR 0033 rather than
something MCP-specific: a second real caller (Seredina's own LLM, not an
external agent) needed zero new gating/auditing code, only a new caller of
`runTool()`.

**A pending-approval tool result is not an error — it's fed back to the
model as a real (if inconclusive) result**, and the system prompt says so
explicitly ("do not retry the same action"), so the model can decide to
escalate or move on rather than looping on a blocked action.

**`MAX_ITERATIONS = 5`, a per-run cap distinct from
`AutonomyPolicy.maxActionsPerDay`** (ADR 0033's existing per-tenant daily
cap, enforced inside `runTool` itself): this is a narrower guard against one
ticket's own loop spinning forever within a single invocation, independent
of whether the tenant's daily budget has room left.

**Cost logging reuses `ai/service.ts`'s existing `logAiUsage`** (exported
for this purpose) rather than a second implementation — every turn of the
loop is its own `adapter.complete()` call and gets its own `AiUsageLog` row,
`action: 'autonomous_loop'`, the same "plain string, not a DB enum" column
this table was designed around from the start (see ADR — the original
`AiUsageLog` comment already anticipated "Phase 3's autonomous mode adds new
actions to this same table, not a new one").

**Trigger: `POST /tickets/:id/ai/autonomous-run`**, gated `tickets:write`
(same tier as suggest-reply/summarize) — triggering the loop is a lighter
action than what it might actually do, since every real mutation inside it
is separately gated by `AutonomyPolicy`. A new "Let AI try" button on
`TicketDetail` alongside Summarize/Suggest reply calls it and renders the
result: a summary, the tool names called, and a link to AI Agent Activity
for anything left pending approval.

### A real, honest zod/zod-to-json-schema type friction, worked around at the type level only

`zod-to-json-schema@3.25.2`'s declared signature, combined with this
codebase's `zod@3.25.76`, makes TypeScript's structural check blow up
("type instantiation is excessively deep") for *any* real zod schema passed
into it directly — reproduced in isolation with a trivial `z.object({...})`,
so this is a genuine library/version friction, not a bug in this session's
own code. Worked around by re-declaring the function's call shape as
non-generic (`(schema: unknown) => Record<string, unknown>`) at the type
level only — the actual runtime call is unaffected, confirmed by every
autonomous-loop test actually exercising the real conversion on every run
(see Verified).

## Consequences

- **Tool-calling reliability through Ollama is genuinely inconsistent**,
  confirmed by testing directly (both through `OllamaAdapter` and with a raw
  `curl` against Ollama's own endpoint, to rule out an SDK-usage mistake on
  this project's part): `qwen2.5-coder:7b` — which Ollama's own `/api/show`
  reports as `tools`-capable — returned the intended tool call as plain JSON
  *text* inside `message.content`, with `finish_reason: "stop"`, not a
  structured `tool_calls` array. Ollama's own docs already call this
  compatibility layer "initial experimental support"; this is a real,
  disclosed limitation of the *local model/Ollama version*, not of this
  adapter's request-building, which was independently confirmed correct via
  the raw `curl` reproduction. A self-hosted operator choosing the local
  option for autonomous mode specifically should expect to verify their own
  pulled model's tool-calling reliability before relying on it.
- **No live Anthropic tool-use verification.** The user's Anthropic key is
  credit-limited; Anthropic's specific content-block tool-use mapping was
  verified by reading the real SDK's type definitions and by code review,
  not by spending real credit on a live call. This is the same trade-off
  this session made for RAG's `suggestReply` UI verification (ADR 0032).
- **`AI_PROVIDER=ollama` inside `docker compose`'s `api` service needs
  `host.docker.internal`, not `localhost`**, to reach an Ollama install on
  the host machine — documented directly in `docker-compose.yml` and
  `.env.example`, not left as a silent surprise.
- **The autonomous loop has no length/complexity limit beyond
  `MAX_ITERATIONS`** — a model that produces a very long tool-result
  transcript before finishing could still consume a lot of context/tokens
  within those 5 iterations. Acceptable for now; a token-budget cap would be
  the next refinement if real usage shows this mattering.

## Verified

**`packages/ai-adapters` unit tests, 19 total** (up from 16): `OpenAIAdapter`
against a fake `fetch` (the SDK's own documented seam) confirms the exact
request shape (system+user messages, `max_completion_tokens`) and response
parsing, including a missing-`usage` fallback to 0 rather than a throw.
`OllamaAdapter` confirms the `ollama:` model-name prefix and the shared
OpenAI-format message translation — plus one test that is **real, not
mocked**, running against this environment's actual local Ollama instance
(skipped automatically if none is reachable, same pattern as this codebase's
`DATABASE_URL`-gated suites): a genuine local completion, live, correctly
prefixed. All existing adapter/pricing/embedding tests continue to pass
unchanged.

**Live, manual, real verification beyond the automated suite** (all against
the actual running dev stack, not mocked): `OllamaAdapter.complete()` against
the real local model answered "2+2" correctly with real non-zero token
counts. A raw `curl` against Ollama's `/v1/chat/completions` with a `tools`
array confirmed the request format is transmitted correctly (the model's own
response referenced the right tool name and argument), isolating the
tool-calling gap described above to Ollama's response translation, not this
project's request-building. **The full `suggestReply` HTTP route was run
end-to-end with `AI_PROVIDER=ollama`** against a real ticket: the real RAG
search ran, the real local model produced a coherent, on-topic printer-
troubleshooting reply, and the resulting `AiUsageLog` row showed
`model: "ollama:qwen2.5-coder:7b"` and `estimatedCostUsd: "0"` — confirming
the entire provider-selection wiring, not just the adapter in isolation.

**`apps/api/test/ai-adapter-selection.test.ts`, 6 tests**: no configuration
returns null; `ANTHROPIC_API_KEY` alone (no `AI_PROVIDER`) still defaults to
Anthropic, proving backward compatibility; `AI_PROVIDER=openai` requires
`OPENAI_API_KEY` and returns null without it; `AI_PROVIDER=ollama` needs no
key at all; `AI_PROVIDER=anthropic` without a key returns null even though
it's the default provider; an unrecognized `AI_PROVIDER` value disables AI
rather than throwing.

**`apps/api/test/ai-autonomous-loop.test.ts`, 6 tests, live Postgres**,
using `TestProviderAdapter`'s new scripted tool-call responses for full
determinism: a read-only `get_ticket` call flows a real result back to the
model before it produces a final summary; a mutating call not on the
allow-list comes back `pendingApproval: true` and genuinely does **not**
execute (checked against the ticket's real messages, not just the return
value); an allow-listed tool (`escalate_to_human`) auto-executes for real
inside the loop and is logged with `source: 'autonomous'`; a tool-execution
error (invalid ticket ID) is reported back as an error result without
crashing the loop; a model that never stops requesting tools is cut off at
exactly `MAX_ITERATIONS`; every completion call inside the loop logs its own
`AiUsageLog` row with `action: 'autonomous_loop'`.

**Frontend verified live in a browser** (Playwright, real dev stack): the
new "Let AI try" button, with its network response mocked (deliberately —
the backend loop behavior above is already fully proven, and a real
multi-turn Ollama round-trip through the UI would be both slow and, per the
tool-calling caveat above, unreliable to depend on for a UI-rendering check)
renders the result panel with the summary text, the tool names called, and
a working link to AI Agent Activity for anything pending approval. Zero
browser console errors. Full `apps/api` suite: 190/190 passing (9 skipped,
unrelated) after all these changes, and `apps/api`/`apps/web`/`apps/worker`/
`apps/mcp-server`/`packages/ai-adapters` all typecheck clean.
