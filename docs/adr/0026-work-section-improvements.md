# ADR 0026: Work section review pass — search, pagination, attachments, and other fixes

## Status

Accepted, implemented.

## Context

Not a roadmap feature — a maintenance pass. The user asked to review the
existing "Work" section (Dashboard, Tickets, TicketDetail, Processes,
Problems) through four lenses (UX/flow, missing functionality, bugs/tech
debt, performance) before continuing the roadmap, then asked to fix
everything the review found. This ADR documents the resulting decisions.

## Decisions

**Zod validation errors are humanized, not dumped as raw JSON.**
`apps/web/src/lib/api.ts`'s `extractErrorMessage` recognized only a plain
string `error` field; every `reply.code(400).send({ error: parsed.error
.flatten() })` response (the pattern used by nearly every route in this
codebase) fell through to `JSON.stringify(error)`, showing a user literally
`{"fieldErrors":{"title":["..."]}}`. `isZodFlattenedError` + `humanizeZodError`
now recognize that specific `{formErrors, fieldErrors}` shape and render
`field: message` pairs instead — every existing form gets this for free,
since the fix is in the shared HTTP client, not per-page.

**Tickets got real search (`q`) and pagination (`limit`/`offset` + `total`),
not fake ones.** The old search box was a decorative `<span>` with no
`<input>` at all. `q` matches subject, contact name, or contact email
case-insensitively (`contains`, not a full-text index — this is a helpdesk
console search box, not a search product). Pagination is offset-based with a
"Load more" button, not page numbers — matches the console's existing
information density and needed the least new UI. The same `limit`/`offset` +
`total` shape was applied to Problems, Process Instances, and the internal
KB article list for consistency, since all four had the identical "returns
every row, forever" gap. Default limit 50, max 200, chosen as a round number
comfortably above any realistic single-screen view.

**An agent can now create a ticket without a Service Catalog item existing.**
`POST /tickets` (tickets:write, JWT-authenticated) is new, but reuses
`createTicketFromApi` — the exact function `/v1/tickets` and the Service
Catalog's request flow already call — just with `channel: 'agent'`. Before
this, "New ticket" always opened the catalog-request modal, and a tenant
with zero catalog items configured had no way to log a ticket by hand at
all. The modal now offers both: a tab toggle when catalog items exist
(defaulting to catalog, the more guided path), skipping straight to the
blank-ticket form when they don't.

**Processes and Problems gained status filter tabs**, mirroring Tickets'
existing ALL/OPEN/PENDING/RESOLVED/CLOSED tab pattern — before this, both
pages showed every instance/problem ever created with no way to narrow to
"still open."

**`TicketDetail`'s `load()` no longer refetches all 7 reference-data
endpoints (statuses, teams, users, assets, custom fields, macros, problems)
on every single mutation.** Split into `loadTicket()` (just the ticket —
called after every status/priority/assignee change, macro run, asset
link/unlink, new message) and `loadReferenceData()` (the 7 lists, called
once on mount). None of those 7 lists ever change as a *result* of editing
a ticket, so the old pattern was pure network waste that got worse every
time a new mutation was added.

**`Problem` gained an optional `ownerId`/`owner`** — the person driving the
RCA, the same "no row = unowned" posture `Ticket.assigneeId` already has.
Real ITIL problem management expects a named owner; before this there was
no way to express "someone is on this."

**File attachments (v1: manual uploads only, on replies/notes).** The
biggest gap the review found — a helpdesk with zero way to attach a
screenshot or a log file. Key decisions:
- **Bytes live in Postgres (`Attachment.data`, `Bytes`), not an
  object-storage bucket.** No MinIO/S3 exists in this stack yet (the
  self-hosted Docker Compose has no such service, and standing one up is
  real scope — a second storage system with its own backup/retention story).
  Two hard caps keep this bounded until real volume justifies revisiting:
  `MAX_ATTACHMENT_SIZE_BYTES` (8MB/file) and `MAX_ATTACHMENTS_PER_MESSAGE`
  (5). Both enforced at the service layer, not just client-side.
- **`@fastify/multipart`, one file per request.** The web app sends one
  upload request per selected file (`sendReply` loops over `pendingFiles`)
  rather than a single multi-file request — simpler on both ends, and lets
  each file fail independently without losing the others.
- **A per-route `bodyLimit` override, separate from the multipart plugin's
  own `fileSize` limit.** Fastify's core `bodyLimit` (1MB globally, see
  `index.ts`) is enforced on the raw incoming stream *before* busboy ever
  sees it — the multipart plugin's `limits.fileSize` alone would never be
  reached for an 8MB file without also raising `bodyLimit` on this specific
  route.
- **Attachment metadata rides along on `GET /tickets/:id` (via `Message.
  attachments`), but never `data`.** The ticket payload needs to know an
  attachment exists to render its chip; it has no business including the
  file bytes on every ticket load. `GET /attachments/:id` fetches the actual
  blob only when a user clicks to download.
- **The already-existing `Content-Disposition` CORS fix (ADR 0024) is what
  makes the download's real filename show up here too** — no new CORS work
  needed, just reuse.

**`getSlaCompliance`'s missing time bound was a genuine, unbounded scale
risk — the one finding from the "performance" lens that wasn't already
reasonably bounded.** Re-auditing all five reporting functions during this
pass found `getTicketVolume`/`getChannelBreakdown` already windowed by
`days`, `getPriorityBreakdown`/`getAgentWorkload` already implicitly bounded
to non-CLOSED tickets, and `getRecentActivity` already capped at a fixed
`limit` — only `getSlaCompliance` queried every resolved ticket a tenant
had ever had, with no bound at all. Now defaults to a rolling 90-day window
(configurable via `?days=`), matching the framing every other widget already
uses. This is a narrower, safer fix than the "rewrite reporting to SQL
GROUP BY" the initial review pass over-worried about — the other four
functions didn't actually need it.

## Verified

10 new integration tests against real Postgres
(`apps/api/test/work-section-improvements.test.ts`): ticket search matches
subject/contact name/email case-insensitively; limit/offset page correctly
and `total` reflects the full match count, not just the page; an
agent-created ticket carries `channel: 'agent'`; Problem create/update
correctly set and clear an owner; Problem/Process-instance status filters
and pagination both work; an attachment round-trips its exact bytes; an
oversized file is rejected; a 6th attachment on one message is rejected;
a second tenant can never read the first tenant's attachment. Full suite
128/128 passing (9 skipped, unrelated) — this includes fixing
`reporting.test.ts`'s SLA compliance test, which had fixture tickets
resolved on a hardcoded January 2026 date that the new 90-day window would
have silently excluded; switched to dates relative to "now." Both
`apps/api`/`apps/web` typecheck clean.

Browser-verified end to end via Playwright, one consolidated pass covering
the whole batch: an invalid tenant slug (uppercase, which the frontend never
blocked client-side) now shows `tenantSlug: tenantSlug must be lowercase
alphanumeric with hyphens` instead of raw JSON; a fresh tenant's "New
ticket" modal skips straight to the blank-ticket form (zero catalog items,
so no tab toggle needed) and successfully creates a ticket; attaching a
real file to a reply, sending it, and clicking the resulting chip produces
a real browser download whose content matches byte-for-byte; the ticket
list's search box actually filters; a Problem created with an owner shows
that owner on both the list and detail page; the Processes page's status
tabs render and switch cleanly. Zero unexpected console errors (the one
logged 400 was the deliberate invalid-slug submission from the humanization
check itself).

## Consequences / known v1 limitations

- Attachments: no inbound-email attachment ingestion (MIME parts from a
  reply-by-email are still dropped) — manual upload only. No delete
  endpoint. No object-storage backend — a tenant with heavy attachment
  volume will eventually want one; the two hard caps are what buys time
  until then.
- The "link an existing ticket" dropdown on Problem detail still fetches
  tickets with the default page size (50) rather than a searchable picker —
  a tenant with more than 50 open tickets may not see every candidate in
  that one dropdown. A real search-as-you-type ticket picker is future work,
  not done here.
- Ticket search is `contains`-based, not full-text — fine at realistic
  volumes, would need revisiting (e.g. Postgres `tsvector`) at real scale.
- "Load more" pagination, not page numbers or infinite scroll — deliberate
  simplicity, revisit if a real usage pattern demands otherwise.
