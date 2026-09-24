# ADR 0057: Microsoft 365 and Gmail email channels over OAuth

## Status

Accepted, implemented.

## Context

An email channel (ADR 0004) logged in to IMAP and SMTP with a username and
password. That no longer works for the two providers most helpdesks use:

- **Microsoft 365** retired Basic Auth for IMAP in Exchange Online and is
  retiring it for SMTP AUTH. A company mailbox can only be read or sent from
  with an OAuth access token.
- **Google Workspace / Gmail** only accepts a password through an "app
  password", which needs 2-Step Verification and which Workspace admins
  often disable.

Both still speak IMAP and SMTP, and both accept an OAuth 2.0 bearer token
through SASL `XOAUTH2`, which `imapflow` and `nodemailer` already support. So
the fix is authentication only: the polling, threading and sending code stays
the same.

## Decision

### Bring-your-own OAuth app

Each tenant registers its own app in Microsoft Entra or Google Cloud and
pastes the client ID and secret into Seredina. There's no Seredina-operated
app, for the same reasons as Slack and Teams in ADR 0048: a shared app would
put this project through Google's restricted-scope verification (the
`https://mail.google.com/` scope needs a yearly security assessment) and
Microsoft's publisher verification, with ongoing cost and a single point of
failure for every install. A self-hosted operator also keeps the grant
entirely inside their own directory.

### Data model

`EmailChannel` gains `authType` (`password` | `google_oauth` |
`microsoft_oauth`), `connectionStatus` (`connected` |
`pending_authorization` | `needs_reconnect`), `lastError`, and the OAuth
fields: client ID, client secret, Microsoft directory, refresh token, and
cached access token with its expiry. Every secret is AES-256-GCM encrypted
with `ENCRYPTION_KEY` like the existing passwords, is never returned by the
API, and is excluded from the data export by its explicit `select`. The two
password columns become nullable, since an OAuth channel has none.

Existing rows default to `password` / `connected`, so nothing changes for
them.

### Consent round trip

1. `POST /email-channels` with an OAuth `authType` creates the channel with
   the provider's fixed servers (`outlook.office365.com` / `smtp.office365.com:587`
   STARTTLS, or `imap.gmail.com` / `smtp.gmail.com:465`), the mailbox address as
   login, and status `pending_authorization`.
2. `POST /email-channels/:id/oauth/authorize` returns the provider's consent
   URL. Google gets `access_type=offline&prompt=consent` (it only issues a
   refresh token on a fresh consent); Microsoft gets `offline_access`.
3. The provider redirects the browser to `GET /email-channels/oauth/callback`.
   A top-level redirect carries no session header, so the tenant and channel
   come from `state`: an HMAC-signed, 10-minute token. Its key is derived from
   `JWT_SECRET` with a purpose label rather than being a JWT signed with the
   session key, so a state value can never pass `app.authenticate`. The code
   is exchanged, the refresh token stored, and the channel marked `connected`.
   The callback always redirects back to the console's Email Channels page,
   with `?oauth=connected` or `?oauth_error=...`.

The redirect URI is `API_PUBLIC_URL` or `WEB_ORIGIN + /api`, followed by
`/email-channels/oauth/callback`, and is shown in the console so the admin
can register the exact value.

The Microsoft directory segment is interpolated into the token endpoint URL,
so it's validated against a strict hostname/GUID pattern. Otherwise a crafted
value could send the client secret to a different path.

### Worker: tokens and revocation

`apps/worker/src/email/credentials.ts` resolves credentials for both IMAP and
SMTP. It reuses the cached access token while more than a minute of validity
remains. Otherwise it refreshes the token, storing the new one and
Microsoft's rotated refresh token.

- A refresh rejected with `invalid_grant`, `invalid_client` or
  `unauthorized_client` means only a human can fix it. The channel is set to
  `needs_reconnect` with the reason.
- `list_active_email_channels()` now returns only `connected` channels, so a
  channel in that state stops being polled instead of failing every 30
  seconds.
- Any other failure (5xx, network) is retried on the next poll.

Every poll failure, for password channels too, is written to `lastError` and
shown in the console. Before this, a wrong password was only visible in the
worker's log.

For OAuth channels, SMTP on a non-implicit-TLS port requires STARTTLS, so a
bearer token never crosses a plaintext session. Password channels keep their
previous behavior.

## Consequences

- Microsoft 365 and Gmail mailboxes can be connected without app passwords.
- Setting up the app in Entra or Google Cloud is a manual step for the admin.
  The console shows short instructions and the redirect URI, and the user
  guide has the full steps.
- This is still polling (IMAP), not push. Microsoft Graph change
  notifications or Gmail Pub/Sub watch would give instant delivery but need
  a publicly reachable webhook and, for Gmail, a Pub/Sub topic. Deferred
  until polling latency is a real complaint.
