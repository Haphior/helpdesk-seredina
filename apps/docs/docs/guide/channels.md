# Inbound Channels

Everything that reaches Seredina ends up as a ticket, no matter which
door it came in through — that convergence is literally what the
product's name means. This page covers how to configure each inbound
channel; for *outbound* notifications (Slack, Teams, your own webhook),
see [Outbound Webhooks](/api/webhooks).

## Email

**Administration → Email Channels → New channel** offers three kinds of
mailbox:

- **Microsoft 365 / Outlook** and **Gmail / Google Workspace** — sign in
  with OAuth. Both providers have turned off (or let admins turn off)
  plain-password IMAP/SMTP, so this is the way to connect a company
  mailbox. Server names and ports are filled in for you.
- **Other (IMAP/SMTP)** — any provider that still accepts a username and
  password: IMAP credentials to read, SMTP credentials to reply.

Every secret (passwords, OAuth client secret, refresh token) is encrypted at
rest with `ENCRYPTION_KEY` (AES-256-GCM) — never stored in plaintext.

### Connecting Microsoft 365 or Gmail

Seredina doesn't ship a shared OAuth app: you register your own in your
Microsoft or Google account (it's free and takes a few minutes), then paste
its client ID and secret into Seredina. The **redirect URI** to register is
shown in the New channel dialog — it's your server's address followed by
`/api/email-channels/oauth/callback`, so `WEB_ORIGIN` (or
`API_PUBLIC_URL`) must be set to the address people use in the browser.

**Microsoft 365** (Azure portal → Microsoft Entra ID → App registrations):

1. **New registration** → any name → supported account types "this
   organizational directory only" → redirect URI of platform **Web** =
   the URI Seredina shows.
2. **API permissions → Add → APIs my organization uses → Office 365
   Exchange Online → Delegated**: `IMAP.AccessAsUser.All` and `SMTP.Send`.
   Also add Microsoft Graph `offline_access`. Click **Grant admin consent**.
3. **Certificates & secrets → New client secret**; copy the *value*.
4. Copy the **Application (client) ID** and **Directory (tenant) ID** from
   the Overview page.
5. Make sure the mailbox has **Authenticated SMTP** enabled (Microsoft 365
   admin center → user → Mail → Manage email apps).

**Gmail / Google Workspace** (Google Cloud console):

1. Create (or pick) a project and **enable the Gmail API**.
2. **OAuth consent screen**: user type *Internal* for Workspace (for a
   personal Gmail account use *External* and add yourself as a test user);
   add the scope `https://mail.google.com/`.
3. **Credentials → Create credentials → OAuth client ID → Web
   application**, add the redirect URI Seredina shows, and copy the client
   ID and secret.

Then in Seredina choose the provider, enter the mailbox address, client ID
and secret (and for Microsoft optionally the directory ID), and click **Save
and sign in**. Sign in *as the mailbox* and accept; you're sent back to the
Email Channels page with the channel **Connected**.

If the provider later revokes access (password reset, admin removed the
app, secret expired), the channel changes to **Reconnect needed** with the
reason, stops being polled, and a **reconnect** link restarts the sign-in.

### How mail is processed

The worker checks every connected mailbox by polling (every
`EMAIL_POLL_INTERVAL_MS`, 30 seconds by default) — it's not a push
subscription. A new email from an unknown sender creates a ticket; a
reply to an existing thread gets added as a message on the matching
ticket. A mailbox that fails to log in shows the error on the Email
Channels page.

## API

For your own integrations — your site, a script, any system that can make
a `POST`. See [REST API](/api/rest-api) for the full technical detail
with examples.

## Embeddable chat widget

A `<script>` tag that turns any web page into a chat channel, with no
account or credential involved. See
[Embeddable Widget](/api/widget).

## Telegram

**Administration → Telegram** — connect your own bot (created with
[@BotFather](https://t.me/BotFather)) by pasting its token. A direct
message to the bot creates a ticket; the agent replies from the console
like any other channel, and the reply reaches the user through Telegram.

::: warning Requires a real public URL
Telegram delivers messages by calling your API directly — you need
`API_PUBLIC_URL` configured with a real, internet-reachable HTTPS
address. `localhost` doesn't work for this particular channel. See
[Environment Variables](/deployment/environment-variables#networking-and-ports).
:::

## Monitoring alerts (NOC/SOC)

**Administration → Monitoring Integrations** has copy-paste-ready
instructions for connecting:

- **Grafana Alerting** — a webhook-type "contact point" pointing at
  `/v1/alerts/grafana`, which accepts Grafana's native payload with no
  transformation needed.
- **Zabbix** — an action/notification script that calls the generic
  `/v1/alerts` endpoint.

Both turn a firing alert into a ticket, with the alert's severity mapped
to a ticket priority. It's the same generic mechanism documented in
[REST API](/api/rest-api#post-v1-alerts) — no backend-specific
integration is needed for every new monitoring tool, anything that can
send a `POST` with a Bearer token works.
