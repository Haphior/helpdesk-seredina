# ADR 0024: Full data portability — one-click JSON export

## Status

Accepted, implemented.

## Context

The second of this pass's three differentiators. The honest opposite of how
a vendor whose business model depends on lock-in treats "export my data" —
Seredina has no reason to make leaving hard, so this ships as a single
`GET /export` that returns everything a tenant would need to migrate away
or restore from, in an open format (JSON, not a proprietary archive).

## Decisions

**Every tenant-scoped table is included, except two deliberate exclusions:
`Notification` and `DiscoveryJob`.** Both are transient operational state
(an inbox of already-delivered alerts, bookkeeping for a finished scan job)
rather than data or configuration a tenant would ever need to migrate or
restore — including them would bloat the export with noise no one reads
back in. Every other tenant-scoped model in `packages/db/src/prisma.ts`'s
`TENANT_SCOPE_FIELD` map is present.

**Secret redaction is an explicit `select` allowlist on four models, never
a denylist.** `User` (excludes `passwordHash`), `ApiKey` (excludes
`hashedKey`), `EmailChannel` (excludes both `*PasswordEncrypted` fields),
`Webhook` (excludes `secretEncrypted`) each list exactly the fields that
are safe to export. A denylist ("select everything, then delete these
keys") would silently start leaking a new secret field the moment one is
added to any of these models without the export code also being updated —
the allowlist fails the opposite way: a new field just doesn't show up in
the export until someone deliberately adds it.

**One `withTenantTx`, running all ~35 queries via `Promise.all`.** Every
query is a plain read with no external I/O, so this is the same reasoning
`getAiUsageSummary` (ADR 0023) and every other multi-table read in this
codebase already follows — safe to hold one transaction open for the whole
batch, and meaningfully faster than 35 sequential round trips.

**JSON, not CSV or a zip of CSVs.** The schema has real nested/relational
structure (a ticket's messages, a process instance's step instances) that
a flat CSV-per-table export would force the reader to manually re-join.
JSON keeps every table as its own top-level array with foreign keys
intact — trivially reconstructable, and still an "open format" in the
sense that matters (no proprietary parser needed).

**Permission tier: `tickets:manage_all`**, the same tier AI Usage, SLA
Policies, and On-Call configuration already sit at — tenant-wide, not a
day-to-day agent action.

**Filename carries the tenant slug and export date**
(`seredina-export-<slug>-<date>.json`) via `Content-Disposition`. This
surfaced a real cross-origin bug during browser verification: `fetch()`
from the web app (port 5173) to the API (port 4000) could read the
response body but not the `Content-Disposition` header, because it isn't
on the cross-origin default-exposed header allowlist — the download
silently fell back to a generic `export.json`. Fixed by adding
`exposedHeaders: ['Content-Disposition']` to the API's `@fastify/cors`
config (`apps/api/src/index.ts`).

**The download itself needed a dedicated fetch, not a plain `<a href>`.**
An anchor tag can't carry the `Authorization` header the API requires, so
`apps/web/src/lib/api.ts` gained `downloadFile(path)`: fetch with the
Bearer token, read the response as a `Blob`, parse the real filename out
of `Content-Disposition`, then trigger a save via a throwaway
object-URL `<a download>` element.

## Verified

4 new integration tests against real Postgres (`apps/api/test/export.test.ts`):
the export includes real rows across multiple tables (ticket, macro,
webhook, API key, email channel) for a populated test tenant; the exported
`users`/`apiKeys`/`emailChannels`/`webhooks` arrays never contain their
respective secret fields (asserted both via `'field' in row` checks and a
raw string search for the plaintext test passwords, to also rule out an
accidental double-encoding leak); the top-level export object has no
`notifications` or `discoveryJobs` key at all; a second tenant's rows never
appear in the first tenant's export, and vice versa. Full suite 112/112
passing (9 skipped, unrelated), both `apps/api`/`apps/web` typecheck clean.

Browser-verified end to end against the real running app via Playwright:
registered a fresh tenant, navigated to the new Data Export page, clicked
"Download export," and captured the actual browser download event. The
saved file parsed as valid JSON containing the tenant record, no
`passwordHash` field on any user, and no `notifications` key — confirming
the redaction and exclusion logic holds through the real HTTP response,
not just the service-layer unit of work. This pass is what caught the
`Content-Disposition` CORS bug above; re-verified clean after the fix,
with the correct `seredina-export-<slug>-<date>.json` filename landing.
Zero console errors.

## Consequences / known v1 limitations

- No import/restore path yet — this ADR ships the export half only.
  Restoring from this file into a fresh tenant is plausible future work,
  not committed to here.
- No streaming — the full payload is built in memory and returned in one
  response. Fine at today's realistic tenant data volumes; a tenant with a
  very large ticket history would need this revisited before it becomes a
  real memory-pressure concern.
- No incremental/partial export (a date range, a subset of tables) — it's
  all-or-nothing by design, matching the "full portability" framing.
