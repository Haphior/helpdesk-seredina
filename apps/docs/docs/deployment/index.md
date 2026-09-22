# Installing with Docker

Seredina deploys as a set of Docker containers. The same install serves
both self-hosted use (a single tenant) and running your own multi-tenant
cloud service — the difference is one environment variable, not a fork or
a different image. See [Cloud mode](/deployment/cloud-mode) for that
distinction.

## Requirements

- Docker and Docker Compose (the `docker compose` plugin, not the old
  standalone `docker-compose` v1 binary).
- A domain or reachable IP if you're exposing the instance beyond your own
  machine — Seredina doesn't manage TLS on its own, so a reverse proxy
  (Caddy, nginx, Traefik) in front of `WEB_PORT`/`API_PORT` is your
  responsibility. The console's live updates use a long-lived
  `GET /events` stream on the API: the API already sends
  `X-Accel-Buffering: no` for nginx, but make sure your proxy doesn't
  buffer that path or cut idle connections in under ~60 seconds (the API
  sends a heartbeat every 25). If live updates can't connect, the console
  falls back to refreshing as it did before.

## Install in three commands

```bash
git clone https://github.com/Haphior/helpdesk-seredina.git
cd helpdesk-seredina
./scripts/setup.sh                                # generates .env with random secrets
docker compose -f infra/docker-compose.yml up -d
```

That's the whole install. `scripts/setup.sh` generates every secret
(`JWT_SECRET`, `ENCRYPTION_KEY`, the Postgres passwords) with
`openssl rand` — never fixed values. The `migrate` service applies the
schema and Row-Level Security policies and exits; `api`, `worker`, and
`web` start after.

Open `http://localhost:8080` (or whatever port you set in `WEB_PORT`) and
register your organization at `/register`. There's no separate CLI
bootstrap step — the same registration flow works identically in
self-hosted and cloud mode.

::: tip Regenerating secrets
`scripts/setup.sh` won't touch an existing `.env`. If you want fresh
secrets from scratch, delete `.env` first — but note this invalidates any
already-stored email channel password, encrypted with the previous
`ENCRYPTION_KEY`.
:::

## What `docker compose` brings up

| Service | What it does |
|---|---|
| `postgres` | The database, with Row-Level Security isolating each tenant |
| `redis` | Job queue (BullMQ) for network discovery, email/webhook sending, and SLA timers |
| `migrate` | Applies the schema, creates the `app_tenant` role, applies RLS policies, and exits — doesn't stay running |
| `api` | The Fastify API — all business logic |
| `worker` | Background processing: agentless discovery, inbound/outbound email, webhooks, notifications, SLA escalation |
| `web` | The agent console (React) |
| `mcp-server-http` | Optional, profile-gated (`--profile mcp`) — the MCP server in HTTP mode for external AI agents, see [MCP Server](/api/mcp-server) |

## If a container won't start

`docker compose -f infra/docker-compose.yml logs api` (or `worker`) is
always the first place to look. Both `api` and `worker` validate **every**
required environment variable at startup and report everything missing or
malformed in a single message — they don't stop at the first missing
variable and force a fix-restart-discover-the-next-one loop.

See also [Environment Variables](/deployment/environment-variables) for
the full reference and [Troubleshooting](/deployment/troubleshooting) for
the most common cases.

## Local development (without Docker for the app itself)

If you're modifying the code rather than just running an instance:

```bash
npm install
docker compose -f infra/docker-compose.yml up -d postgres redis
npm run dev:api

# in a second terminal
npm run dev --workspace=apps/web   # http://localhost:5173

# in a third, only if you need discovery/email working locally
npm run dev --workspace=apps/worker
```

Requires Node.js 20+ (Fastify 5 and `@fastify/jwt` 10 require it). The
schema, migrations, and seed live in `packages/db`, not `apps/api` — run
`npm run prisma:generate|prisma:migrate|prisma:deploy|prisma:seed
--workspace=@seredina/db`.
