# Environment Variables

The complete reference for `.env` (see `.env.example` in the repo, which
is the source of truth — this page explains it in prose).
`scripts/setup.sh` automatically generates everything marked "generated
secret"; everything else has a sensible default or is optional.

## Database and queue

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_USER` | Yes | The migration user (`app_migrator` by default). Only `migrate` connects with this role. |
| `POSTGRES_PASSWORD` | Yes (generated secret) | The migration user's password. |
| `POSTGRES_DB` | Yes | The database name (`seredina` by default). |
| `POSTGRES_PORT` | No | The port exposed by the Postgres container (`5432` by default). |
| `REDIS_PORT` | No | The port exposed by Redis (`6379` by default). |
| `APP_TENANT_DB_PASSWORD` | Yes (generated secret) | Password for the `app_tenant` role, created by `packages/db/prisma/rls/policies.sql` at migration time. **The only role `api` and `worker` ever connect as** — they never use the migration role in production. |

## Security

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes (generated secret) | Signs session tokens. |
| `JWT_EXPIRES_IN` | No | How long a console login lasts before the user has to sign in again (`8h` by default; accepts values like `30m`, `12h`, `1d`). Deactivating a user or changing their role takes effect immediately regardless. |
| `ENCRYPTION_KEY` | Yes (generated secret) | Encrypts email channel IMAP/SMTP passwords at rest (AES-256-GCM), plus other per-tenant secrets. **Must be exactly 64 hex characters** (`openssl rand -hex 32`). |

::: warning Losing this `ENCRYPTION_KEY` is irreversible
If you lose it or rotate it without migrating existing data, **every**
already-stored email channel password becomes undecryptable — back it up
with the same seriousness as a database password.
:::

## Deployment mode

| Variable | Required | Description |
|---|---|---|
| `SEREDINA_MODE` | Yes | `self_hosted` or `cloud`. See [Cloud mode](/deployment/cloud-mode) for what this actually changes. |

## AI copilot (optional)

Unconfigured, the AI copilot responds with a clear 503 instead of the API
refusing to boot — it's an optional feature, not an install requirement.

| Variable | Required | Description |
|---|---|---|
| `AI_PROVIDER` | No | `anthropic`, `openai`, or `ollama`. Left unset, defaults to `anthropic` if `ANTHROPIC_API_KEY` is set (backward compatibility). |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | No | A key from [console.anthropic.com](https://console.anthropic.com/). `ANTHROPIC_MODEL` overrides the default model. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | No | A key from [platform.openai.com](https://platform.openai.com/). |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | No | No per-call cost — runs against a local [Ollama](https://ollama.com) install. `OLLAMA_BASE_URL` defaults to `http://localhost:11434/v1`. |

On top of this deployment-level configuration, any tenant can bring their
own key (BYOK) from Settings → AI in the console — if they have one, it's
used *exclusively*, never falling back to the deployment's global config.

## Networking and ports

| Variable | Required | Description |
|---|---|---|
| `API_PORT` | No | The API's port (`4000` by default). |
| `WEB_PORT` | No | The web console's port (`8080` by default). |
| `WEB_ORIGIN` | Yes | Must match how the browser reaches the console (never the in-compose-network hostname). Also read by `api` to build its own public links (e.g. a CSAT survey link) — left unset, that one feature just silently no-ops. |
| `VITE_API_URL` | Yes | How the browser reaches the API. |
| `API_PUBLIC_URL` | Only if using Telegram | A real, internet-reachable HTTPS base URL for your API — Telegram calls it directly to deliver messages, so it can never be `localhost` or an internal compose hostname. |

## Other optional variables

| Variable | Required | Description |
|---|---|---|
| `SENTRY_DSN` | No | Error tracking (`api`/`worker`/`web`). Unset, it no-ops — points at Sentry.io or a self-hosted [GlitchTip](https://glitchtip.com/) instance (protocol-compatible with the Sentry SDK). |
| `EMAIL_POLL_INTERVAL_MS` | No | How often the worker checks each active email channel's IMAP inbox (`30000` ms by default). |
| `MCP_HTTP_PORT` | No | Only used by the `mcp-server-http` service, profile-gated (`docker compose --profile mcp up`). See [MCP Server](/api/mcp-server). |

## Startup validation

`api` and `worker` validate **every** required variable at startup and
report everything missing or malformed in a single message — they don't
stop at the first missing variable. If a container won't start,
`docker compose logs api` (or `worker`) is always the first place to
look.
