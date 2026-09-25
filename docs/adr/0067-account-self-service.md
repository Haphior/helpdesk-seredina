# ADR 0067: Account self-service: password change and reset, invitations, ending sessions

## Status

Accepted, implemented.

## Context

Only an admin could set a console user's password. A new account's
password was invented by the admin and shared by hand. Nobody could change
their own password, and someone who forgot it had to find an admin.

Sessions are 8-hour JWTs. Deactivating a user or changing their role
already took effect on the next request, because every request re-reads
the user. A password change did not: a stolen session kept working until
it expired, even after the owner changed the password to lock the thief
out.

## Decision

### Changing a password ends the other sessions

`users.sessions_valid_after` is set whenever the password changes, by any
route. `getActiveUserPermissions` (called by `app.authenticate` on every
request, and every minute by the live-updates stream) now also takes the
token's `iat` and refuses a token issued in an earlier second. The
comparison is in whole seconds because `iat` has one-second resolution. A
token issued in the same second as the change stays valid: that's the
fresh token handed back to whoever changed their own password.

The routes that change a password:
- your own change;
- a reset link;
- an accepted invitation;
- an admin's reset.

### Your own password

`POST /auth/password` takes `{ currentPassword, newPassword }`, authenticated
and rate limited. A wrong current password counts toward the same lockout
as a failed sign-in, so a session left open on someone else's screen can't
be used to guess it. The answer carries a new token for this session. It's
audited as `auth.password_changed`.

### Forgotten password

`POST /auth/password/forgot` takes `{ tenantSlug, email }` and always
answers 202, whether or not the address has an account. At most 3 emails
per address per hour. The link goes to `/reset-password#<token>`.

### Invitations

`POST /users` takes either a `password` (as before) or `invite: true`:
- The account is created with a hash of random bytes nobody knows, and
  `users.invited_at` is set.
- The person gets a 7-day link to `/accept-invite#<token>`.
- `POST /users/:id/invite` sends it again while the invitation is pending,
  and the user list shows it.
- Without a connected email channel the request is refused (409) before
  the account is created, so a failed invitation never leaves behind an
  account nobody can sign in to.

### The links

Both links carry a purpose-bound token (`lib/purposeToken.ts`, purposes
`password-reset` and `account-invite`). The token holds the tenant, the
user and a fingerprint of the current password hash:
- Setting a password changes the hash, so a link works once.
- Any other password change also invalidates older links.
- The final update is conditional on the hash still matching, so two tabs
  racing on one link can't both succeed.
- The token rides in the URL fragment, so it never reaches a server log or
  a `Referer` header, and the page clears it from the address bar.

`POST /auth/password/token` says what a link is for (reset or invitation,
the email, the organization) before anything changes.
`POST /auth/password/set` sets the password. It doesn't sign the person in:
they sign in normally afterwards, so two-factor sign-in and SSO
enforcement still apply.

Emails go through the workspace's own email channel, on the same queue as
customer portal links.

## Consequences

- Without a connected email channel there are no invitations or reset
  emails. Admins still set and reset passwords by hand.
- Signing out on a password change is all-or-nothing per user. There's no
  list of sessions to end one by one: that would need server-side sessions,
  which the JWT design avoids.
- Resetting two-factor sign-in (ADR 0061) doesn't end sessions. That
  change is about the next sign-in.
