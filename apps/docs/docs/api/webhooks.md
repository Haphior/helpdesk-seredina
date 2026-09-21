# Outbound Webhooks

The reverse direction of the REST API: instead of you calling Seredina,
Seredina notifies you when something happens. Configured from
**Operations → Webhooks** in the console.

## Webhook kinds

There are three kinds, and the kind is fixed when the webhook is created
— it can't be changed afterward (deleting and creating a new one is the
same amount of work anyway):

| Kind | For | Signature |
|---|---|---|
| `generic` | Your own receiver — an endpoint you wrote | Yes, HMAC-SHA256 |
| `slack` | Posts directly to a Slack channel, via its "Incoming Webhooks" | No |
| `teams` | Posts directly to a Teams channel, via the "Workflows" app | No |

Slack/Teams webhooks are deliberately **"bring your own URL"**: you
generate the webhook in your own workspace (Slack: Incoming Webhooks;
Teams: the "Post to a channel when a webhook request is received"
template in the Workflows app) and paste that URL into Seredina — there's
no Slack/Teams app Seredina operates and no third-party approval process
involved.

## Available events

A `generic` webhook can subscribe to any combination of these five:

- `ticket.created`
- `ticket.updated`
- `message.created`
- `sla.first_response_breached`
- `sla.resolution_breached`

`slack`/`teams` webhooks are limited to a subset of three —
`ticket.created`, `sla.first_response_breached`,
`sla.resolution_breached` — because `ticket.updated` carries ids instead
of readable text, and `message.created` could leak an internal note or a
customer's own message into a possibly-public channel without you
explicitly choosing that.

## Signature (`generic` webhooks only)

Every delivery to a `generic` webhook includes the
`X-Seredina-Signature: sha256=<hmac>` header, computed with the secret
Seredina generated when the webhook was created (shown once, same as an
API Key):

```js
const crypto = require('crypto');

function verifySignature(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```

`slack`/`teams` webhooks **carry no signature** — neither platform's
incoming webhook has that concept, and the URL you generated in your own
workspace is the only credential.

## Payload

A `generic` webhook receives the full event:

```json
{
  "event": "ticket.created",
  "occurredAt": "2026-09-21T14:32:00.000Z",
  "data": { "...": "..." }
}
```

A `slack`/`teams` webhook receives an already-formatted plain-text
message, ready to post as-is:

```json
{ "text": "🎫 New ticket #142: Printer jammed on 3rd floor" }
```

## Retries

Every delivery runs through the job queue (BullMQ) with retry and
backoff — a temporary outage on your endpoint doesn't lose the event. The
last delivery's status (success/error and when) is visible directly in
the webhook list in the console.

## Creating one

```bash
curl -X POST https://your-instance.example.com/webhooks \
  -H "Authorization: Bearer <your agent session>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.example.com/seredina-webhook",
    "events": ["ticket.created", "sla.first_response_breached"],
    "kind": "generic"
  }'
```

`kind` is optional and defaults to `generic`. This call uses your own
agent session (not an API Key) because it's tenant configuration, not a
public endpoint — do it from the console instead of by hand unless you
specifically need to automate it.
