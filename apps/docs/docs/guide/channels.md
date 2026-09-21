# Inbound Channels

Everything that reaches Seredina ends up as a ticket, no matter which
door it came in through — that convergence is literally what the
product's name means. This page covers how to configure each inbound
channel; for *outbound* notifications (Slack, Teams, your own webhook),
see [Outbound Webhooks](/api/webhooks).

## Email

**Administration → Email Channels** — each channel needs IMAP credentials
(to read) and SMTP credentials (to reply), plus a name and the "from"
address contacts see. Passwords are encrypted at rest with
`ENCRYPTION_KEY` (AES-256-GCM) — never stored in plaintext.

The worker checks every active mailbox by polling (every
`EMAIL_POLL_INTERVAL_MS`, 30 seconds by default) — it's not a push
subscription. A new email from an unknown sender creates a ticket; a
reply to an existing thread gets added as a message on the matching
ticket.

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
