# Getting Started

This guide covers the agent console: how to use every feature from the
inside, once you already have an instance running. If you haven't
installed Seredina yet, start with
[Installing with Docker](/deployment/).

## Creating your organization

Visit `/register` on your instance and fill out the form — organization
slug, your name, email, and password. That first registration
automatically makes you an administrator — there's no separate CLI
bootstrap step.

::: tip One registration in self-hosted mode
If your instance runs `SEREDINA_MODE=self_hosted` (the default mode),
only one organization can register — this is intentional, see
[Cloud mode](/deployment/cloud-mode) if you need more than one.
:::

## The getting-started checklist

The first time you log in, the dashboard shows a "Get started" widget
with four tasks: customize your ticket statuses, set an SLA policy,
create a macro, and invite a teammate. It's not mandatory to complete in
order — it's a guide, not a forced flow — and you can hide it at any time
with the eye icon in the widget's corner.

## Inviting your team

There's no email invitation flow yet — from **Administration → Users**,
an admin creates the account directly (name, email, initial password,
role) and shares the password outside the app. The invited person can
change it afterward from their own profile.

## How this guide is organized

The left-hand navigation follows the same groups as the console's own
sidebar:

- **[Tickets](/guide/tickets)** — the queue, ticket detail, macros, merging, bulk actions
- **[SLA & Escalation](/guide/sla-and-escalation)**
- **[CMDB & Assets](/guide/cmdb-and-assets)** — assets, agent-enrolled devices, equipment catalog
- **[Knowledge Base](/guide/knowledge-base)**
- **[Service Catalog](/guide/service-catalog)**
- **[Processes, Changes & Problems](/guide/processes-and-templates)**
- **[AI Copilot](/guide/ai-copilot)**
- **[Inbound Channels](/guide/channels)** — email, API, widget, Telegram, Slack/Teams, alerts
- **[Reports & Dashboard](/guide/reports-and-dashboard)**
- **[CSAT Surveys](/guide/csat-surveys)**
- **[Administration](/guide/administration)** — users, roles, API keys, appearance, language
- **[Public Portal](/guide/public-portal)** — self-service and the status page
