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

Start on **Email Channels**: the last sign-in error for each mailbox shows
there.

- **"Reconnect needed"** on a Microsoft 365 or Gmail channel: the provider
  revoked access (the mailbox password changed, an admin removed the app,
  or the consent expired). The channel stops being polled until you click
  **reconnect** and sign in as the mailbox again. Nothing is lost:
  unread mail is picked up once it's connected.
- **Microsoft or Google says the redirect URI doesn't match**: the URI
  registered in your app must be exactly
  `<WEB_ORIGIN>/api/email-channels/oauth/callback` (or
  `<API_PUBLIC_URL>/email-channels/oauth/callback` when that's set). See
  [Connecting Microsoft 365 or Gmail](/guide/channels#connecting-microsoft-365-or-gmail).
- **Password mailboxes after changing `ENCRYPTION_KEY`**: every secret saved
  with the old key is unreadable. Re-enter the password (or reconnect an
  OAuth channel) from Email Channels.

Otherwise, check the `worker` logs: `worker` polls the mailboxes, not
`api`.

## Someone lost their authenticator app

They can sign in with one of their **recovery codes** instead of the
6-digit code. Each works once.

With no recovery codes left, another admin resets their two-factor
sign-in from **Administration → Users** (reset 2FA). They set it up again
at their next sign-in if the workspace requires it.

If the person locked out is the **only admin**, nobody can reset them from
the console. Reset it in the database directly (replace the slug and the
email):

```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U app_migrator seredina -c "
  UPDATE users SET mfa_secret_encrypted = NULL, mfa_pending_secret_encrypted = NULL,
    mfa_enabled_at = NULL, mfa_last_used_step = NULL, mfa_recovery_code_hashes = '{}',
    failed_login_attempts = 0, locked_until = NULL
  WHERE email = 'admin@example.com'
    AND tenant_id = (SELECT id FROM tenants WHERE slug = 'your-organization');"
```

A change made this way doesn't appear in the audit log. Make sure a second
admin exists afterwards so this isn't needed again.

## Single sign-on isn't working

- **The provider shows an error before coming back**: the redirect URI
  registered with the provider must match the one shown on
  **Administration → Single sign-on** exactly.
- **"Accounts from example.com can't sign in to this workspace"**: that
  domain isn't in the allowed domains list. Add it, or clear the list.
- **"There's no account for … in this workspace"**: automatic account
  creation is off. Create the user first, or turn it on and choose the role
  new users get.
- **Locked out by "require SSO"** while the provider is down: admins can
  always sign in with their password. Turn "require SSO" off until the
  provider is back.

## Portal links, invitations or password resets don't arrive

These emails go out through your email channels, so at least one must be
**connected** (check Email Channels for errors). Invitations refuse to
send without one; a password reset or portal link silently can't. For portal and reset links, each
address can get at most 3 per hour, and the page says the same thing
whether or not the address is known, so a typo looks like success. A send
that fails is logged by `worker`. Links go to `WEB_ORIGIN`, which must be the
address people can reach.

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
