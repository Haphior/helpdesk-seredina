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
  machine. Seredina can serve it over HTTPS itself — see
  [Your address and HTTPS](#your-address-and-https) — or you can keep your
  own reverse proxy (nginx, Traefik, …) in front of `WEB_PORT`. If you use
  your own, note that the console's live updates use a long-lived
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

## Your address and HTTPS

Out of the box Seredina answers on `http://localhost:8080`. To serve it at
your own domain or IP, with HTTPS, run:

```bash
./scripts/configure-address.sh
docker compose -f infra/docker-compose.yml up -d --build
```

The script asks for the address (a domain like `helpdesk.example.com`, or
the server's IP) and how to get the certificate:

| Mode | Use it when | What you need |
|---|---|---|
| `acme` | The server is reachable from the internet | A domain pointing at the server, ports 80 and 443 open. Let's Encrypt issues and renews the certificate automatically. |
| `custom` | You have a certificate from your company's CA or a provider | The certificate (full chain) and key files. The script checks the key matches, that the certificate covers your address, and that it was signed by the CA you give it. |
| `internal` | An internal network, or an IP address | Nothing — a private CA is generated on first start. |
| `off` | A lab, or TLS already ends in front of this server | Nothing. Passwords travel unencrypted. |

It can also run without questions, e.g.
`./scripts/configure-address.sh --address 192.168.1.20 --tls internal`
(`--help` lists every option), and you can re-run it any time to change the
address or the mode.

What it changes:

- Starts the `proxy` service (Caddy) on ports 80 and 443. Plain HTTP
  redirects to HTTPS.
- The console and the API share the one address: the API is at
  `https://<address>/api`. That's also the address agents, the embeddable
  widget and monitoring integrations use from now on.
- The web (8080) and API (4000) ports then only listen on the server
  itself, so the network can only come in through HTTPS. Use
  `--keep-direct-ports` to leave them open while you move things over.

**Agents.** The Devices page puts the right address in each enrollment
command. With `custom` (company CA or self-signed) or `internal`, the command
also carries the CA's fingerprint: the agent downloads the CA, checks it
against that fingerprint, and from then on trusts only that CA. Nothing to
copy to the device. An agent enrolled at the old `http://<ip>:4000` address
needs the new command; re-enrolling keeps its existing record.

**Browsers with `internal`.** Browsers warn until they trust the generated
CA. Export it and install it on your team's computers (or through group
policy):

```bash
docker compose -f infra/docker-compose.yml cp proxy:/data/caddy/pki/authorities/local/root.crt ./seredina-root-ca.crt
```

The certificates and the internal CA live in the `caddy_data` volume — back
it up with the rest, or agents will need re-enrolling after a new CA.

## What `docker compose` brings up

| Service | What it does |
|---|---|
| `postgres` | The database, with Row-Level Security isolating each tenant |
| `redis` | Job queue (BullMQ) for network discovery, email/webhook sending, and SLA timers |
| `migrate` | Applies the schema, creates the `app_tenant` role, applies RLS policies, and exits — doesn't stay running |
| `api` | The Fastify API — all business logic |
| `worker` | Background processing: agentless discovery, inbound/outbound email, webhooks, notifications, SLA escalation |
| `web` | The agent console (React), and the API under `/api` on the same address |
| `proxy` | Optional (`COMPOSE_PROFILES=proxy`, set by `configure-address.sh`) — HTTPS in front of everything, see [above](#your-address-and-https) |
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
