# MCP Server

`apps/mcp-server` exposes the same tool catalog the internal AI copilot
uses (look up/reply to/change status of/assign/apply a macro to/escalate a
ticket) to **your own** MCP-compatible agent — Claude Desktop, an n8n
flow, your own script. It's how you connect an external AI agent to
Seredina without reimplementing any business logic or bypassing any
authorization controls.

## Two transports

Chosen with `MCP_TRANSPORT` (defaults to `stdio`):

### `stdio`

A separate process from `api`/`worker` — not part of a plain
`docker compose up`. The client spawns it per session and owns its
stdin/stdout directly, the same way Claude Desktop spawns any other local
MCP server. The tenant is resolved once at startup, from
`SEREDINA_API_KEY`.

```bash
# 1. Create an API Key from Administration -> API Keys in the console.

# 2. Build the image:
docker build -f infra/docker/Dockerfile.mcp-server -t seredina-mcp-server .

# 3. Point your MCP client at:
docker run -i --rm \
  -e SEREDINA_API_KEY=<your key> \
  -e DATABASE_URL=... \
  -e ENCRYPTION_KEY=... \
  seredina-mcp-server
```

In development, running `apps/mcp-server` directly with `tsx`/`node` (see
the `dev` script in `apps/mcp-server/package.json`) skips the image build
step.

### `http`

A genuinely always-on network service (Streamable HTTP, deliberately
stateless), for a remote or long-running agent instead of a locally
spawned one. Every request carries its own `Authorization` header with a
Bearer API Key — the tenant is resolved per request, never cached
server-side.

```bash
docker compose --profile mcp up mcp-server-http
```

Deliberately profile-gated — a plain `docker compose up` never starts it.
You can also run it directly with `MCP_TRANSPORT=http` in
`apps/mcp-server`.

## Authorization

Every tool call that changes data goes through the tenant's Autonomy
Policy (**Operations → AI Agent Activity** in the console): tools not on
the auto-execute allow-list wait there for a human to approve or reject —
and **every** call, whether auto-executed or not, lands in the same audit
log. Your external agent has exactly the same limits as the internal
copilot, not a separate path with fewer controls.

## Tool catalog

The same set the internal copilot uses for its autonomous mode — look up
a ticket, add a reply, change status, assign, apply a macro, escalate.
See [AI Copilot](/guide/ai-copilot) in the user guide for how the
human-approval side works from the console.
