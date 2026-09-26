# Cloud mode (multi-tenant)

Seredina doesn't have a separate "cloud" fork or a different image. The
same codebase, the same containers, run in both modes — the only real
difference is one environment variable: `SEREDINA_MODE`.

## What actually changes

`SEREDINA_MODE=self_hosted` (the default) makes registering a second
organization fail explicitly:

> `this self-hosted instance already has a tenant -- self-hosted mode
> supports exactly one`

It's architecturally single-tenant: meant for a company to install for
itself, not to resell access to others. The first registration (the one
that creates your own organization) works normally; it's the *second*
attempt at `/register` that gets blocked.

`SEREDINA_MODE=cloud` removes that limit — anyone can register their own
organization at `/register`, each isolated from the others by Postgres
Row-Level Security (see the
[multi-tenancy architecture](https://github.com/Haphior/helpdesk-seredina/blob/main/docs/adr/0001-multi-tenancy-rls.md)
if you're curious about the technical detail). This is what you need if
you're going to run Seredina as your own service for multiple customers.

Cloud mode also turns off **network scans from the server** (Assets →
"Scan a network range"). In self-hosted mode the worker sits on your own
network, so scanning it is useful; in cloud mode it would sit on the
provider's network, so the option is hidden and the API refuses it.
Cloud tenants discover devices with the [endpoint agent](https://github.com/Haphior/seredina-agent)
instead: each enrolled agent reports its own inventory plus the devices it
sees in its ARP table, without scanning anything.

## What cloud mode does *not* include yet

Being direct about this rather than implying it's a flip-a-switch-and-done
feature:

- **No pricing tiers or billing.** There's no plan/billing model built —
  that's a deliberately unmade business decision, not a technical
  oversight.
- **No production infrastructure included.** `docker compose` gets you
  running containers; TLS, your own domain, automated backups,
  monitoring, and high availability are the operator's responsibility,
  same as with any other self-hosted software.
- **No Terms of Service or Privacy Policy.** If you're going to process
  real customer data on your own infrastructure, those documents (and
  GDPR compliance if you have EU users) are yours to sort out — Seredina
  doesn't assume anything about your legal situation.

## Isolation between tenants

Every row of every tenant-scoped table carries a `tenant_id`, and
Postgres enforces Row-Level Security at the database level — it's not a
`WHERE tenantId = ...` clause a developer could forget to add to a new
query. The `app_tenant` role (the only one `api` and `worker` ever
connect as) is physically unable to read or write rows outside the active
tenant context of that transaction.
