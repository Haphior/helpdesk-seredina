# AI Copilot

The copilot has three modes, from least to most autonomous, all available
from the same [ticket detail view](/guide/tickets#the-properties-panel).

## Summarize

The **Summarize** button generates a short summary of the whole ticket —
useful for picking up an old case or handing it to another agent without
re-reading the entire thread. It shows up in a highlighted panel above
the messages, and never replaces the real history.

## Suggest reply

**Suggest reply** drafts a response based on the ticket's content and,
when it finds something relevant, on published
[knowledge base](/guide/knowledge-base) articles (semantic similarity
search, not exact keyword matching). The draft appears directly in the
reply box — the agent edits it or sends it as-is, it's never sent on its
own. If it used an article, it's listed as "Based on:" below the box.

## Autonomous mode ("Let AI try")

Here the copilot can investigate the ticket and, if confident, **act** on
it — not just draft text. The key difference from the two modes above is
that it can actually execute tools (look up data, change status, assign,
apply a macro, add a reply), always subject to the tenant's Autonomy
Policy.

### Autonomy Policy

From **Operations → AI Agent Activity**, you configure:

- **Auto-execute tool allow-list** — only the tools explicitly allowed
  there execute immediately. Any other call lands in a "pending approval"
  state for a human to review before anything happens.
- **Daily action limit** — a hard cap, independent of how many tools are
  approved for auto-execution.

Every call — auto-executed or pending — lands in the same audit log, with
the tool used, its arguments, the result, and where the call came from
(the internal copilot, or an external agent via the
[MCP server](/api/mcp-server) — they share the exact same catalog and the
exact same rules, there's no separate path with fewer controls for
external integrations).

## AI cost transparency

**Operations → AI Usage** shows the real dollar cost of every copilot
call, aggregated per tenant. Since the AI provider key can be the
tenant's own (bring your own key, from **Settings → AI**), Seredina never
adds a markup — the cost shown is exactly what the provider charges.

## No AI provider configured

If neither the tenant nor the deployment has an AI key configured, these
three buttons return a clear error instead of failing silently or
blocking the rest of the app — the rest of Seredina works exactly the
same without AI configured. See
[Environment Variables](/deployment/environment-variables#ai-copilot-optional)
to configure a provider at the deployment level.
