# ADR 0061: Two-factor sign-in with an authenticator app (TOTP)

## Status

Accepted, implemented.

## Context

A password was the only thing protecting an account that can read every
ticket, reconfigure integrations, or enroll endpoint agents. Password
reuse and phishing make that the most likely way in. Security reviews and
cyber-insurance questionnaires ask for MFA first.

## Decision

### TOTP, built in

RFC 6238 time-based codes (SHA-1, 6 digits, 30 s), which every authenticator
app supports: Microsoft Authenticator, Google Authenticator, 1Password, Authy,
and others. The algorithm is about 40 lines on `node:crypto`
(`packages/shared/src/totp.ts`, tested against the RFC's vectors). The QR
code is rendered server-side as SVG with `qrcode` (MIT) and shown through an
`<img>` data URL, so it can never run as markup.

WebAuthn/passkeys would be stronger, but they need per-origin setup that
fights with "self-hosted at any address", so they're left for later. SMS is
deliberately excluded: it costs money per message and is weaker.

### Storage

- The secret is encrypted with `ENCRYPTION_KEY`. The server recomputes codes
  from it, so it can't be hashed.
- A **pending** secret exists between "show the QR code" and "confirm the
  first code", so a half-finished setup never locks anyone out, and moving to
  a new phone doesn't break the old one until the new one is confirmed.
- `mfaLastUsedStep` refuses any code at or before the last accepted step. A
  code seen over someone's shoulder can't be replayed within its 90-second
  window.
- 10 one-time **recovery codes**, stored as SHA-256 hashes. They're
  high-entropy, so a fast hash is correct, just like API keys. Each works
  once. Using one is audited.

### Sign-in becomes two requests

`POST /auth/login` with a correct password and MFA on returns
`{ mfaRequired, mfaToken }` and **no session**. The `mfaToken` is a 5-minute
purpose-bound HMAC token (`lib/purposeToken.ts`). Its key is derived from
`JWT_SECRET` plus the purpose, so it's useless as a session and useless for
any other step. `POST /auth/login/mfa` trades it plus a TOTP or recovery code
for the session.

Wrong codes count toward the **same lockout** as wrong passwords, and the
counter is **not** reset by a correct password while a code is still owed.
Without that, someone holding the password could retry codes forever by
signing in again between guesses.

### Workspace enforcement

`Tenant.mfaRequired` makes every user enroll. A user without MFA who signs
in gets `{ mfaSetupRequired, mfaToken }`. The console walks them through the
QR code and first code right there (`/auth/login/mfa-setup[/confirm]`), then
signs them in and shows their recovery codes. While it's required, users
can't turn MFA off. Only an admin who has MFA on can turn the requirement
on, so the admin isn't the first one surprised by it.

### Self-service and recovery

**Account security** (shield icon next to sign-out) lets each user turn MFA
on, move it to a new phone, generate new recovery codes (a current code is
required), and turn it off (the password is required again, so a stolen
session alone can't strip the second factor). An admin with `users:manage`
can **reset** a user's MFA from the Users page for a lost phone. Every step is
in the audit log (ADR 0060).

## Consequences

- An admin who loses both their phone and their recovery codes needs another
  admin to reset them. In a single-admin workspace, only direct database
  access can reset them, which is why the recovery-codes screen asks people
  to keep them in a password manager.
- API keys, device credentials, and the MCP server are unaffected. They
  aren't interactive sign-ins.
