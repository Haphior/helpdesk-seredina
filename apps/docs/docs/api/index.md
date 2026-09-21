# Authentication

Seredina has two completely separate authentication mechanisms for two
different audiences — don't mix them up.

## API Keys — for integrations (what you want)

If you're integrating something external (a contact form, your own
monitoring, a script), **this is what you want**. API Keys authenticate
against the public API-channel and alert-ingestion endpoints
(`/v1/tickets`, `/v1/alerts`, `/v1/alerts/grafana`) — never against the
agent console.

### Creating a key

From the console: **Administration → API Keys → New Key**. The full value
(prefixed `sk_`) is shown **once** when created — Seredina only stores its
hash, never the plaintext value, so if you lose it you'll need to
generate a new one.

### Using it

```bash
curl -X POST https://your-instance.example.com/v1/tickets \
  -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Cannot access my account",
    "body": "Tried resetting the password three times.",
    "contactEmail": "customer@example.com",
    "contactName": "Ana Customer"
  }'
```

The key identifies the tenant automatically — no need to send a
`tenantId` in the body, the server resolves it from the key's hash.

### Revoking a key

From the same place you created it — **Administration → API Keys**. A
revoked key stops working immediately; any integration still using it
starts getting `401`.

## Agent session (JWT) — for the web console

When an agent logs in (`POST /auth/login`), they receive a short-lived
JWT token the browser stores and sends on every following request. **This
token is for the web console, not for external integrations** — it isn't
meant to be used by a third-party script, and its permissions depend on
the agent's role (see [Administration](/guide/administration) in the user
guide for roles and permissions).

## Next steps

- [REST API](/api/rest-api) — the public endpoints an API Key can call,
  in detail.
- [Outbound Webhooks](/api/webhooks) — the other direction: Seredina
  notifying you when something happens.
- [MCP Server](/api/mcp-server) — connect your own AI agent (Claude
  Desktop, an n8n flow, a script) against the same tool catalog the
  copilot uses.
- [Embeddable Widget](/api/widget) — a `<script>` tag that turns any
  website into a chat channel into Seredina.
