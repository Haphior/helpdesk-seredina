# ADR 0023: AI cost transparency, per ticket and per tenant

## Status

Accepted, implemented.

## Context

The first of this pass's three differentiators — deliberately not
competitive parity, something none of Jira SM/GLPI/ServiceDesk Plus offer.
"Because the `LlmProviderAdapter` is already a bring-your-own-key design,
Seredina is structurally able to show a tenant exactly what each AI action
cost in real dollars — something no per-seat SaaS competitor bundling AI
into its price can offer, because the incentive runs the other way for
them." Doesn't wait for Phase 3's `AiAgentRun`/`AutonomyPolicy` audit
engine — a lightweight table written by the copilot calls that already
exist today (`suggest_reply`, `summarize`) is enough to start.

## Decisions

**`CompleteResult` gained a `model` field.** The adapter is the one source
of truth for which model actually served a call — `AnthropicAdapter`'s
model can differ from its hardcoded default via `ANTHROPIC_MODEL`, so
re-deriving "which model" at the call site would duplicate logic that
already lives in the adapter and could drift from it. Every implementation
of `LlmProviderAdapter` (including `TestProviderAdapter`, now reporting
`model: 'test-model'`) returns it.

**Pricing is a plain object in `packages/ai-adapters/src/pricing.ts`, not a
database table.** A model's price is a fact about that model, not
tenant-configurable data — adding a new model already means a code change
(a new adapter default), so its price lives next to that same code. Cached
from Anthropic's own pricing table (dated in the file's own comment); the
function returns `null` for a model it doesn't recognize rather than
guessing a number — an unpriced call still logs its real token counts, just
with `estimatedCostUsd: null`, never a fabricated cost.

**`AiUsageLog.action` is a plain string, matching `DashboardWidget.widgetType`'s
posture, not a DB enum.** Phase 3's autonomous mode will add new AI actions
to this same table — an open action vocabulary needs no migration to grow,
the same reasoning that kept `WidgetType` a string.

**The usage row is written by the AI service functions themselves
(`suggestReply`, `summarizeTicket`), immediately after `adapter.complete()`
returns — not in the routes, and not estimated after the fact.** Any future
AI action that reuses these service functions gets usage logging for free;
a route-level wrapper would need to be added to every new AI route
individually. The write is its own short `withTenantTx`, separate from the
transaction that read the ticket thread — consistent with this codebase's
standing rule that network I/O (the LLM call in between) never happens
inside a tenant transaction.

**Per-ticket usage is `tickets:read`; the tenant-wide summary is
`tickets:manage_all`.** Seeing what AI cost on a specific ticket is
information anyone who can see that ticket should have (visible right next
to the Summarize/Suggest-reply buttons); seeing the tenant's *total* AI
spend is financial visibility, the same tier SLA Policies and On-Call
configuration already sit at, not a day-to-day ticket action.

**The AI Usage page got its own sidebar entry** (`Configuration` group,
alongside SLA Policies, On-Call & Escalation, and Business Hours) rather
than being folded into an existing page — unlike Notification Settings
(ADR 0022), which is personal and reachable only from the bell dropdown,
this is tenant-wide operational visibility an admin would want a permanent,
discoverable way back to, matching the precedent every other tenant-wide
config page in that group already sets.

## Verified

4 new integration tests against real Postgres
(`apps/api/test/ai-usage.test.ts`) plus the existing 3 AI tests re-run
clean: `suggestReply` logs a usage row with real token counts and a null
cost for `TestProviderAdapter`'s deliberately-unpriced `'test-model'`;
`summarizeTicket` logs its own row under a distinct action; the tenant-wide
summary correctly aggregates calls and cost by action across multiple
tickets, and confirms total cost stays exactly `0` rather than
substituting a guessed number for the null costs in this suite; a ticket
with no AI activity at all reports a clean zero, not an error. Full suite
108/108 passing (9 skipped, unrelated), both `apps/api`/`apps/web`
typecheck clean, `packages/ai-adapters`' own test suite (2/2) still green
after the `CompleteResult.model` addition.

Browser-verified end to end against the real running app: registered a
fresh tenant and confirmed the AI Usage page renders its zero state
correctly (`$0.0000`, `0` calls, "No AI activity yet") and that a ticket
with no AI activity shows no cost pill. Zero console errors. **The actual
live Anthropic network call was deliberately not exercised in this
browser pass** — this session is working with the user's own,
credit-limited API key from earlier verification work, and re-spending it
here for a cost-transparency feature would be its own small irony. The
logging path itself (the part this ADR actually adds) is fully exercised
by the integration tests via `TestProviderAdapter`, which runs through the
identical `logAiUsage` code a real Anthropic call would.

## Consequences / known v1 limitations

- No time-window filtering on the tenant summary (last 7/30 days, a date
  range) — `recent` is simply the last 20 calls, and the totals are
  all-time. A real reporting view (charts, date ranges) would build on this
  table, not replace it.
- No per-user or per-team breakdown, only per-action and per-ticket.
- Pricing is a point-in-time cache in code, not fetched live — a real price
  change means a code change (a one-line table update) before newly-logged
  calls reflect it; already-logged rows keep whatever cost was computed at
  the time.
- Still just two AI actions (`suggest_reply`, `summarize`) — this ADR adds
  no new AI capability, only cost visibility into the ones that already
  existed.
