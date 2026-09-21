# Troubleshooting

## A container won't start

`docker compose -f infra/docker-compose.yml logs api` (or `worker`,
`web`, `migrate`) is always the first place to look. `api` and `worker`
validate **every** required environment variable at startup and report
everything missing or malformed in a single message — they don't stop at
the first missing one and force a fix-restart-discover-the-next-one loop.

## "this self-hosted instance already has a tenant"

You're in `SEREDINA_MODE=self_hosted` (the default, meant for a single
organization) and tried to register a second one. If you genuinely need
multiple independent organizations, that's
[cloud mode](/deployment/cloud-mode), not self-hosted.

## Invalid `ENCRYPTION_KEY`

It needs to be exactly 64 hexadecimal characters (32 bytes) — generate it
with `openssl rand -hex 32`. A value that's shorter, longer, or contains
characters outside `0-9a-f` makes `api` refuse to start with a message
pointing at this exact variable.

## The AI copilot responds with 503

This is the expected behavior without an AI provider configured — not an
install error. Check `AI_PROVIDER` and the matching key
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or that `OLLAMA_BASE_URL` points
at an actually-running Ollama instance) in
[Environment Variables](/deployment/environment-variables). Also check
that the tenant doesn't have its own broken key set in Settings → AI — if
a tenant has its own key, it's used *instead of* the deployment's, never
as a fallback.

## Telegram isn't delivering messages

`API_PUBLIC_URL` needs to be a real, internet-reachable HTTPS URL —
Telegram calls it directly to deliver every message, so `localhost` or an
internal Docker Compose hostname will never work. If you're testing
locally without a public domain, Telegram isn't viable yet — use an email
channel or the API instead.

## An email channel stopped syncing

IMAP/SMTP passwords are encrypted with `ENCRYPTION_KEY` when saved. If you
rotated that key without migrating existing data, every password saved
before the change becomes undecryptable — reload it from Settings → Email
Channels. Otherwise, check the `worker` logs (it's the one doing IMAP
polling, not `api`).

## Port already in use

`API_PORT` (4000), `WEB_PORT` (8080), `POSTGRES_PORT` (5432), and
`REDIS_PORT` (6379) are the four ports exposed to the host. If any of them
conflicts with something else already running on your machine, change it
in `.env` — nothing else needs to change, `docker-compose.yml` reads all
of them as variables.

## `docker compose` isn't recognized

You need the modern plugin (`docker compose`, no hyphen), not the old
standalone `docker-compose` v1 binary (with a hyphen) — they're different
packages. On Ubuntu/Debian, `sudo apt install docker-compose-plugin`
installs it; Docker Desktop already includes it.

## None of this fixes your issue

Open an
[issue on GitHub](https://github.com/Haphior/helpdesk-seredina/issues)
with the output of `docker compose logs` for the failing service and your
`.env` **with the secret values stripped out** (variable names, not
values).
