# ADR 0029: Administration review pass — API key revocation, user offboarding

## Status

Accepted, implemented.

## Context

The fourth and final section of the user's requested review-then-fix pass,
covering the Administration nav group (Users, API Keys). This section's
findings were security-relevant, not just UX gaps:

- **An API key could never be revoked.** No delete endpoint existed at all
  — a leaked or decommissioned key stayed valid forever.
- **A user could never be deactivated.** No offboarding path existed for an
  employee who leaves.
- **Account lockout (already implemented in `login()`) was completely
  invisible.** `failedLoginAttempts`/`lockedUntil` were tracked in the
  database but never surfaced anywhere, and there was no way for an admin to
  clear a lockout early.
- No admin-initiated password reset, relevant specifically because this
  codebase has no email/invite flow yet (a documented, deliberate gap —
  `createUser`'s own comment) — password recovery had genuinely no path at
  all beyond an admin already knowing the old one.

## Decisions

**API keys get a real `DELETE /api-keys/:id`.** No soft-delete needed here
— an API key has no other data referencing it, so a hard delete is safe and
matches how every other secret-bearing resource in this codebase (Webhooks)
already treats revocation as a first-class action.

**User deactivation is a soft `isActive` flag, deliberately not a hard
delete.** Checked the actual FK behavior before deciding: `Ticket.assignee`
and `Message.authorUser` have no `onDelete` action specified, which Postgres
resolves to `NO ACTION` — a hard delete would be *blocked* the moment any
ticket or message references that user, which is true for essentially every
real agent. Worse, `OnCallShift`/`EscalationTier` are `onDelete: Cascade` on
User, so a delete that *did* succeed would silently erase on-call
configuration nobody asked to touch. A soft flag sidesteps all of this:
`login()` rejects a deactivated user with the same generic `'invalid
credentials'` error as a wrong password or an active lockout (identical
anti-enumeration posture to every other branch in that function), while
every historical reference (assigned tickets, authored messages, on-call
shifts) stays exactly as it was.

**Self-deactivation is blocked at the service layer, not the route, so it's
covered by the same integration-test convention as everything else in this
codebase.** `updateUser` takes an optional `callerId` parameter; when the
caller is deactivating their own account, it throws before touching the
database. A lone admin locking themselves out with nobody else able to log
in and reactivate them would be a real, unrecoverable footgun — worth a
hard block rather than a confirmation dialog alone.

**Lockout is now visible and admin-reversible.** `listUsers` derives a
plain `isLocked` boolean (`lockedUntil` is set and still in the future)
rather than exposing the raw timestamp — the UI only ever needs to decide
whether to show an "unlock" button, never to compute or display a
countdown. `unlockUser` clears `failedLoginAttempts` and `lockedUntil`
directly, the same escape hatch an admin would want instead of telling
someone to "just wait 15 minutes."

**Admin password reset is its own explicit endpoint
(`POST /users/:id/reset-password`), not a field on the generic `PATCH
/users/:id`** — same reasoning already established for webhook secret
rotation (ADR 0028) and repeated here: a password change is sensitive
enough to deserve its own action, never a side effect of an unrelated edit.
It also clears any existing lockout, so a reset password isn't immediately
unusable if the account happened to be locked when the reset happened.

**Both pages got the same visual-language pass as every other page fixed in
this review series** (`Users.tsx`/`ApiKeys.tsx` were still on the old
spacing/color/typography, `text-red-600` instead of `text-rose-600`, a plain
HTML `<table>`) — restyled to match the rest of the app.

## Verified

6 new integration tests against real Postgres
(`apps/api/test/administration.test.ts`): a deactivated user's login is
rejected with the generic error and a reactivated user's login succeeds
again; a self-deactivation attempt is rejected; `listUsers` correctly
reports `isActive`/`isLocked` for every user; a real lockout (5 genuine
failed logins through `login()`, not a manufactured DB state) is visible via
`listUsers` and `unlockUser` restores login before the 15-minute window
would have elapsed; `resetUserPassword` changes the password (old password
now rejected, new one accepted) and clears any lockout; a revoked API key
disappears from `listApiKeys` and a second revoke attempt 404s. Full suite
146/146 passing (9 skipped, unrelated), both `apps/api`/`apps/web`
typecheck clean.

Browser-verified end to end via Playwright against the real running app:
created a second user and confirmed it shows Active; confirmed the
logged-in admin's own row has no deactivate control at all; deactivated and
reactivated the second user, watching the badge and role-select disabled
state change live; drove 5 genuine failed `POST /auth/login` attempts
against the real endpoint (not a manufactured lockout) and confirmed the
"Locked" badge appears after a page reload, then clicked "unlock" and
confirmed it disappears; reset the user's password through the UI and
confirmed via direct API calls that the old password is now rejected and
the new one works; created a real API key, confirmed the once-only secret
banner, revoked it, and confirmed it vanishes from the list. Zero console
errors. (One non-issue worth recording: an earlier run of this same script
tripped Fastify's per-route rate limit on `/auth/login` — max 10/minute,
shared across script runs from the same local IP within that window — which
silently prevented the lockout counter from incrementing at all. Not a bug;
resolved by waiting out the window / restarting the dev server to clear the
in-memory rate-limit store between manual test runs.)

## Consequences / known v1 limitations

- No audit trail of who deactivated/reactivated a user, reset a password, or
  unlocked an account — these are silent admin actions, same posture every
  other resource in this codebase already has pre-review (create/delete
  already had no audit trail either).
- No bulk actions (deactivate several users at once) — one-at-a-time only,
  matching this session's general policy of not adding functionality beyond
  what the review found missing.
- Still no email-based self-service password reset or account invites —
  explicitly out of scope until the email channel exists as a real send
  path from the app itself, not just inbound ticket ingestion (see
  `createUser`'s original comment; unchanged by this pass).
- No pagination on Users/API Keys lists — left as-is; typical self-hosted
  org/integration counts don't yet justify it, unlike Tickets/Assets which
  hit this at realistic scale.
