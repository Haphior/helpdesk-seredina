# REST API

The public API (authenticated with
[API Keys](/api/#api-keys-for-integrations-what-you-want)) is deliberately
small: create tickets from outside, and turn monitoring alerts into
tickets. It's not a full CRUD surface — the web console talks to a much
larger internal API (`/tickets`, `/users`, `/assets`, ...), but that one is
built for Seredina's own frontend, authenticated by agent session, not for
third-party integrations.

Every endpoint returns JSON. An invalid body returns `400` with
[Zod](https://zod.dev)'s validation detail; a missing or invalid key
returns `401`.

## `POST /v1/tickets`

Creates a ticket as if it arrived from a contact form or your own
integration — the channel is recorded as `api`.

```bash
curl -X POST https://your-instance.example.com/v1/tickets \
  -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Cannot access my account",
    "body": "Tried resetting the password three times.",
    "contactEmail": "customer@example.com",
    "contactName": "Ana Customer",
    "priority": "HIGH"
  }'
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `subject` | string | Yes | 1–200 characters |
| `body` | string | Yes | The ticket's first message |
| `contactEmail` | string | Yes | A valid email |
| `contactName` | string | Yes | |
| `priority` | `LOW` \| `NORMAL` \| `HIGH` \| `URGENT` | No | `NORMAL` if omitted |

Returns `201` with the created ticket.

## `POST /v1/alerts`

The generic entry point for NOC/SOC: any monitoring tool that can make a
`POST` with a Bearer token can turn an alert into a ticket. It's the same
mechanism the platform-specific integrations (Grafana, Zabbix) use under
the hood.

```bash
curl -X POST https://your-instance.example.com/v1/alerts \
  -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "source": "zabbix",
    "severity": "HIGH",
    "title": "Disk at 95% on db-prod-01",
    "description": "The /var/lib/postgresql partition is at 95% usage.",
    "externalId": "zbx-88213"
  }'
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string | Yes | 1–100 characters — the name of the tool sending the alert |
| `severity` | `CRITICAL` \| `HIGH` \| `MEDIUM` \| `LOW` \| `INFO` | No | Maps to the ticket's priority |
| `title` | string | Yes | 1–200 characters |
| `description` | string | No | |
| `externalId` | string | No | The alert's id in the source system — useful for deduplication |

## `POST /v1/alerts/grafana`

Same as `/v1/alerts`, but accepts Grafana Alerting's own native "contact
point" webhook payload directly — nothing needs transforming on Grafana's
side, just point the URL and set `Authorization: Bearer sk_...` in the
custom header Grafana lets you configure. See
[Channels](/guide/channels#monitoring-alerts-noc-soc) in the user guide
for the step-by-step setup from Grafana/Zabbix.

## Errors

| Code | When |
|---|---|
| `400` | The body fails validation — the response includes field-by-field detail |
| `401` | The `Authorization` header is missing, or the key is invalid/revoked |
| `201` | Success — returns the created resource |
