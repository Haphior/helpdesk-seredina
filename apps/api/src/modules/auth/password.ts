import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma, withTenantTx } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
import { signPurposeToken, verifyPurposeToken } from '../../lib/purposeToken';
import { contactEmailQueue } from '../../lib/queue';
import { rateLimitRedis } from '../../lib/rateLimitRedis';
import { webOrigin } from '../../lib/publicUrl';
import { resolveTenantIdBySlug } from '../tenants/service';
import { LOCKOUT_DURATION_MS, MAX_FAILED_LOGIN_ATTEMPTS } from './service';

/**
 * Account self-service -- docs/adr/0067-account-self-service.md: changing your
 * own password, resetting a forgotten one by email, and accepting an emailed
 * invitation. Every password change ends the user's other sessions.
 *
 * Reset and invitation links carry a purpose-bound token (lib/purposeToken.ts)
 * holding a fingerprint of the current password hash. Setting a password
 * changes the hash, so a link works once, and an older link stops working as
 * soon as the password changes by any route.
 */

export class PasswordError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const RESET_PURPOSE = 'password-reset';
const INVITE_PURPOSE = 'account-invite';
const RESET_TTL_MS = 30 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_EMAILS_PER_ADDRESS_PER_HOUR = 3;
const BCRYPT_COST = 12;

type SetupKind = 'reset' | 'invite';
interface SetupPayload {
  t: string; // tenant
  u: string; // user
  f: string; // password-hash fingerprint
  n: string; // nonce
}

function fingerprint(passwordHash: string): string {
  return sha256Hex(passwordHash).slice(0, 24);
}

function readSetupToken(token: string): { kind: SetupKind; payload: SetupPayload } | null {
  const reset = verifyPurposeToken<SetupPayload>(RESET_PURPOSE, token);
  if (reset) return { kind: 'reset', payload: reset };
  const invite = verifyPurposeToken<SetupPayload>(INVITE_PURPOSE, token);
  if (invite) return { kind: 'invite', payload: invite };
  return null;
}

/** Emails go through the workspace's own email channel, like the portal's sign-in links. */
export async function hasConnectedEmailChannel(tenantId: string): Promise<boolean> {
  const count = await withTenantTx(prisma, tenantId, (tx) => tx.emailChannel.count({ where: { connectionStatus: 'connected' } }));
  return count > 0;
}

// ---------------------------------------------------------------------------
// Changing your own password
// ---------------------------------------------------------------------------

/**
 * A wrong current password counts toward the same lockout as a failed sign-in,
 * so a session left open on someone else's screen can't be used to guess it.
 */
export async function changeOwnPassword(tenantId: string, userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await withTenantTx(prisma, tenantId, (tx) => tx.user.findUnique({ where: { id: userId } }));
  if (!user || !user.isActive) throw new PasswordError('unauthorized', 401);
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new PasswordError('Too many wrong attempts. Try again later.', 429);
  }

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    const failedLoginAttempts = user.failedLoginAttempts + 1;
    const lockedOut = failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: lockedOut
          ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) }
          : { failedLoginAttempts },
      }),
    );
    throw new PasswordError('Your current password is wrong.', 400);
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new PasswordError('Choose a password different from your current one.', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null, sessionsValidAfter: new Date(), invitedAt: null },
    }),
  );
}

// ---------------------------------------------------------------------------
// Forgotten password
// ---------------------------------------------------------------------------

/**
 * Always "succeeds" from the caller's point of view, whether or not the address
 * has an account, so the page can't be used to find out who works somewhere.
 */
export async function requestPasswordReset(tenantSlug: string, rawEmail: string): Promise<void> {
  const tenantId = await resolveTenantIdBySlug(tenantSlug);
  if (!tenantId) return;
  const email = rawEmail.trim().toLowerCase();

  const key = `seredina:password-reset:${tenantId}:${sha256Hex(email)}`;
  const count = await rateLimitRedis.incr(key);
  if (count === 1) await rateLimitRedis.pexpire(key, 60 * 60 * 1000);
  if (count > RESET_EMAILS_PER_ADDRESS_PER_HOUR) return;

  const found = await withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, isActive: true } });
    if (!user) return null;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    return { user, tenantName: tenant.name };
  });
  if (!found) return;

  const token = signPurposeToken<SetupPayload>(
    RESET_PURPOSE,
    { t: tenantId, u: found.user.id, f: fingerprint(found.user.passwordHash), n: randomBytes(8).toString('hex') },
    RESET_TTL_MS,
  );
  // A fragment, so the token never reaches a server log or a Referer header.
  const link = `${webOrigin()}/reset-password#${token}`;
  await contactEmailQueue.add(
    'send',
    {
      tenantId,
      to: found.user.email,
      subject: `Reset your ${found.tenantName} password`,
      text:
        `Someone asked to reset the password for ${found.user.email} on ${found.tenantName}.\n\n` +
        `Choose a new password here:\n\n${link}\n\n` +
        `The link works once and expires in 30 minutes. If it wasn't you, ignore this email: your password hasn't changed.`,
    },
    { removeOnComplete: 100, removeOnFail: 100 },
  );
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * Called right after an account is created without a password: the account
 * gets an unguessable placeholder hash, and the person chooses their own
 * password from the emailed link.
 */
export async function sendInvitation(tenantId: string, userId: string, invitedByName: string | null): Promise<void> {
  if (!(await hasConnectedEmailChannel(tenantId))) {
    throw new PasswordError('Connect an email channel first: invitations are sent from it.', 409);
  }
  const found = await withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new PasswordError('user not found', 404);
    if (!user.invitedAt) throw new PasswordError('This person has already set their password.', 409);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true } });
    return { user, tenant };
  });

  const token = signPurposeToken<SetupPayload>(
    INVITE_PURPOSE,
    { t: tenantId, u: userId, f: fingerprint(found.user.passwordHash), n: randomBytes(8).toString('hex') },
    INVITE_TTL_MS,
  );
  const link = `${webOrigin()}/accept-invite#${token}`;
  const by = invitedByName ? `${invitedByName} invited you` : 'You were invited';
  await contactEmailQueue.add(
    'send',
    {
      tenantId: tenantId,
      to: found.user.email,
      subject: `You're invited to ${found.tenant.name} on Seredina`,
      text:
        `Hi ${found.user.name},\n\n${by} to join ${found.tenant.name}'s helpdesk.\n\n` +
        `Choose your password here:\n\n${link}\n\n` +
        `The link expires in 7 days. Afterwards, sign in at ${webOrigin()}/login with the organization "${found.tenant.slug}" and ${found.user.email}.`,
    },
    { removeOnComplete: 100, removeOnFail: 100 },
  );
}

// ---------------------------------------------------------------------------
// Using a reset or invitation link
// ---------------------------------------------------------------------------

async function loadSetupTarget(token: string) {
  const read = readSetupToken(token);
  if (!read) throw new PasswordError('This link has expired or was already used. Ask for a new one.', 400);
  const { kind, payload } = read;
  const found = await withTenantTx(prisma, payload.t, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: payload.u } });
    const tenant = await tx.tenant.findUnique({ where: { id: payload.t }, select: { slug: true, name: true } });
    return user && tenant ? { user, tenant } : null;
  });
  if (!found || !found.user.isActive || fingerprint(found.user.passwordHash) !== payload.f) {
    throw new PasswordError('This link has expired or was already used. Ask for a new one.', 400);
  }
  return { kind, tenantId: payload.t, ...found };
}

/** What the set-password page shows before anything changes. */
export async function describeSetupToken(token: string) {
  const { kind, user, tenant } = await loadSetupTarget(token);
  return { kind, email: user.email, name: user.name, tenantSlug: tenant.slug, tenantName: tenant.name };
}

export async function completePasswordSetup(token: string, newPassword: string) {
  const { kind, tenantId, user, tenant } = await loadSetupTarget(token);
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  // Conditional on the fingerprint still matching, so two tabs racing on the
  // same link can't both succeed.
  const updated = await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null, sessionsValidAfter: new Date(), invitedAt: null },
    }),
  );
  if (updated.count === 0) throw new PasswordError('This link has expired or was already used. Ask for a new one.', 400);
  return { kind, tenantId, userId: user.id, email: user.email, tenantSlug: tenant.slug };
}
