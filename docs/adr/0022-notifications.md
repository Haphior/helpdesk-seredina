# ADR 0022: Notification preferences per agent — in-app and email, both new

## Status

Accepted, implemented.

## Context

"Email vs. in-app, immediate vs. digest — currently there's no per-agent
choice at all in how they're told about ticket activity." Before designing
this, an investigation confirmed neither delivery mechanism existed at all:
no `Notification` model, no bell/dropdown anywhere in `apps/web`, and the
only agent-facing "someone gets told" pattern in the whole codebase was the
escalation engine's private `SYSTEM` message on a ticket (ADR 0020). Email
delivery existed, but hardcoded to a `Ticket.contact.email` — never a
`User`.

## Decisions

**Two trigger events for v1, not the full space of "ticket activity":**
`TICKET_ASSIGNED` (assigning a ticket to a new, different, real user) and
`NEW_REPLY` (a contact's inbound email reply landing on a ticket that
already has an assignee). Chosen as the two highest-value, lowest-ambiguity
cases an agent actually needs to know about — not, say, every status
change or every internal note, which would be noisy defaults for a feature
whose whole point is giving agents *control* over noise.

**"No row = default (`inApp: true`, `email: false`)"**, the same posture
`SlaPolicy`/`DashboardWidget` already established — a user who's never
touched their settings has zero `NotificationPreference` rows, and every
service function resolves the default itself rather than requiring a
migration-time backfill for every existing user.

**No digest mode in this pass** — "immediate vs. digest" from the roadmap
note is explicitly deferred. A digest needs a batching job with its own
"since when" cursor per user, a genuinely separate feature from "should
this fire immediately," and building it now would have doubled this ADR's
scope for a mode nobody's asked to use yet. Documented here as a known v1
limitation, not silently dropped.

**The email-sending SMTP-transport logic was extracted out of
`send.ts`** (`createTransportForChannel`, now in
`apps/worker/src/email/transport.ts`) so the new notification-email sender
doesn't duplicate the decrypt-and-configure-nodemailer logic. Both now call
the same function; only what's sent and to whom differs.

**Both `notifyUser` and the email-sending queue exist in duplicate across
apps/api and apps/worker, on purpose** — the same reuse-vs-duplicate call
ADR 0020 already made for the escalation engine, for the identical reason:
`apps/worker` never imports `apps/api` code (confirmed again by checking
`apps/worker/package.json`'s dependencies), and `TICKET_ASSIGNED` fires from
`apps/api`'s `updateTicket` while `NEW_REPLY` fires from `apps/worker`'s own
inbound-email ingest (`apps/worker/src/email/poll.ts` → `ingest.ts`) — a
worker-side path that has no route through apps/api at all. Both copies of
`notifyUser` do the identical "check preference → maybe write an in-app
row → maybe enqueue an email job" dance; only `apps/worker` ever *consumes*
the email queue (`sendNotificationEmail`), since it's the only place
nodemailer/`EmailChannel` wiring exists — apps/api's producer and
apps/worker's producer both target one queue name,
`NOTIFICATION_EMAIL_QUEUE_NAME`.

**A notification email is best-effort, unlike the ticket-reply email
path.** `sendEmailMessage` (the ticket-reply sender) throws if the tenant
has no active `EmailChannel` — a customer-facing reply that silently
vanishes would be a real problem. `sendNotificationEmail` just returns
early instead — a notification a tenant never configured email for isn't a
failure, it's an unconfigured feature; the in-app notification (if the
preference calls for it) already delivered the news regardless.

**`updateTicket` notifies only on a genuine change to a new, real
assignee** — re-saving the same `assigneeId`, or clearing it to `null`,
notifies no one. Captured inside the transaction (a cheap read of the
ticket's *previous* `assigneeId`) but acted on only after the transaction
closes, since `notifyUser` does its own I/O (a queue enqueue), which never
belongs inside `withTenantTx`.

**A genuinely unrelated pre-existing bug was found and fixed while
verifying this feature**: `Users.tsx`'s `CreateUserModal` computed its
`roleKey` default once, from whatever `roles` prop existed at the modal's
first render — if the parent's `/roles` fetch hadn't resolved yet (a real
race, not a hypothetical), `roleKey` stayed permanently empty and every
user-creation attempt 400'd with a cryptic zod error. Fixed with a small
`useEffect` that fills in the default once `roles` actually arrives, if it
hadn't already. Caught because this session's browser verification needed
to create a second agent account, and the flow simply didn't work.

## Verified

8 new integration tests against real Postgres
(`apps/api/test/notifications.test.ts`): no-row defaults resolve to
`inApp: true, email: false`; `notifyUser` writes an in-app row when the
preference allows it; turning `inApp` off for one event type stops that
type specifically while a different event type for the same user is
unaffected; notifications are scoped per user; marking one notification
read doesn't touch others, and `markAllNotificationsRead` clears every
unread one; marking another user's notification read is rejected as
not-found; assigning a ticket to a new user notifies them while re-saving
the same assignee or clearing it does not; reassigning notifies the new
assignee, not the old one. Full suite 104/104 passing (9 skipped,
unrelated), all three of `apps/api`/`apps/web`/`apps/worker` typecheck
clean.

Browser-verified end to end against the real running app: assigned a
ticket to a second agent as the admin, logged in as that agent, confirmed
the bell badge showed the unread count, opened the dropdown and saw the
notification body, clicked it to navigate straight to the ticket, confirmed
the badge cleared afterward, then visited the notification settings page
(reachable only from the bell dropdown, not the main sidebar — deliberately
kept off the nav to avoid adding an 20th item to an already-grouped
sidebar), toggled the email preference on, and confirmed it persisted
across a full page reload. Zero console errors throughout. Email
*delivery* itself (an actual SMTP send) was not exercised live in this
pass — it reuses `createTransportForChannel`, the exact same code the
already-working ticket-reply email path uses, so the marginal new risk is
just the queue plumbing, which is covered by the typecheck and by the
`sendEmailMessage` refactor not changing that function's own behavior.

## Consequences / known v1 limitations

- No digest mode — every notification is immediate; "digest" from the
  roadmap note is deferred, not built.
- Only two trigger events (`TICKET_ASSIGNED`, `NEW_REPLY`) — no
  notification for a status change, a private note, an SLA breach, or an
  escalation (those already get a system message on the ticket itself, per
  ADR 0020).
- Email delivery was not live-verified in this pass (see above) — the code
  path reuses an already-working helper, but no browser test actually sent
  a real SMTP message for a notification specifically.
- No web push or mobile push — "email vs. in-app" from the roadmap note is
  the whole space this covers.
