import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { prisma, withTenantTx } from '@seredina/db';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  sha256Hex,
  totpKeyUri,
  verifyTotp,
  type Permission,
} from '@seredina/shared';
import { signPurposeToken, verifyPurposeToken } from '../../lib/purposeToken';
import { recordAudit } from '../audit/service';
import { LOCKOUT_DURATION_MS, MAX_FAILED_LOGIN_ATTEMPTS, type AuthResult, type RequestOrigin } from './service';

/**
 * Two-factor sign-in with an authenticator app -- docs/adr/0059-mfa-totp.md.
 *
 * Sign-in becomes two requests when MFA applies: /auth/login checks the
 * password and returns a short-lived "mfa" purpose token instead of a
 * session; /auth/login/mfa trades that token plus a code for the session.
 * If the tenant requires MFA and the user hasn't enrolled, the same token
 * lets them enroll right there (the "mfa_setup" steps) before getting in.
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_PURPOSE = 'mfa-challenge';

interface ChallengePayload {
  t: string; // tenant
  u: string; // user
  s: 'verify' | 'setup';
}

export class MfaError extends Error {}

export function issueMfaChallenge(result: AuthResult): string {
  return signPurposeToken<ChallengePayload>(CHALLENGE_PURPOSE, { t: result.tenantId, u: result.userId, s: result.mfa! }, CHALLENGE_TTL_MS);
}

function readChallenge(token: string, stage: 'verify' | 'setup'): { tenantId: string; userId: string } {
  const data = verifyPurposeToken<ChallengePayload>(CHALLENGE_PURPOSE, token);
  if (!data || data.s !== stage) throw new MfaError('Your sign-in expired. Enter your password again.');
  return { tenantId: data.t, userId: data.u };
}

function hashRecoveryCode(code: string): string {
  return sha256Hex(normalizeRecoveryCode(code));
}

async function permissionsOf(tenantId: string, userId: string): Promise<Permission[]> {
  const user = await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
    }),
  );
  return (user.role?.permissions.map((rp) => rp.permission.key) ?? []) as Permission[];
}

type CodeCheck = { ok: true; method: 'totp' | 'recovery_code' } | { ok: false; lockedOut: boolean };

/**
 * Checks a TOTP or recovery code for a user and applies the outcome in the
 * same transaction: marks the step or recovery code used on success, counts
 * the failure toward the same lockout as a wrong password otherwise.
 */
async function checkCode(tenantId: string, userId: string, code: string): Promise<CodeCheck> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || !user.mfaSecretEncrypted || (user.lockedUntil && user.lockedUntil > new Date())) {
      return { ok: false, lockedOut: false };
    }

    const step = verifyTotp(decryptSecret(user.mfaSecretEncrypted, ENCRYPTION_KEY!), code, { lastUsedStep: user.mfaLastUsedStep });
    if (step !== null) {
      await tx.user.update({ where: { id: userId }, data: { mfaLastUsedStep: step, failedLoginAttempts: 0, lockedUntil: null } });
      return { ok: true, method: 'totp' };
    }

    const hash = hashRecoveryCode(code);
    if (normalizeRecoveryCode(code).length === 12 && user.mfaRecoveryCodeHashes.includes(hash)) {
      await tx.user.update({
        where: { id: userId },
        data: { mfaRecoveryCodeHashes: user.mfaRecoveryCodeHashes.filter((h) => h !== hash), failedLoginAttempts: 0, lockedUntil: null },
      });
      return { ok: true, method: 'recovery_code' };
    }

    const failedLoginAttempts = user.failedLoginAttempts + 1;
    const lockedOut = failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    await tx.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: lockedOut ? 0 : failedLoginAttempts,
        lockedUntil: lockedOut ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
      },
    });
    return { ok: false, lockedOut };
  });
}

/** Second step of sign-in. */
export async function completeMfaLogin(mfaToken: string, code: string, origin: RequestOrigin): Promise<AuthResult> {
  const { tenantId, userId } = readChallenge(mfaToken, 'verify');
  const result = await checkCode(tenantId, userId, code);
  const email = await withTenantTx(prisma, tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { email: true } }));

  if (!result.ok) {
    await recordAudit(tenantId, {
      action: 'auth.login_failed',
      actorType: 'user',
      actorUserId: userId,
      actorLabel: email?.email,
      metadata: { reason: 'wrong_mfa_code' },
      ...origin,
    });
    if (result.lockedOut) {
      await recordAudit(tenantId, {
        action: 'auth.account_locked',
        actorType: 'system',
        target: { type: 'user', id: userId, label: email?.email },
        metadata: { failedAttempts: MAX_FAILED_LOGIN_ATTEMPTS, lockMinutes: LOCKOUT_DURATION_MS / 60_000 },
        ...origin,
      });
    }
    throw new MfaError('That code is not valid.');
  }

  await recordAudit(tenantId, {
    action: 'auth.login_succeeded',
    actorType: 'user',
    actorUserId: userId,
    actorLabel: email?.email,
    metadata: { mfa: result.method },
    ...origin,
  });
  if (result.method === 'recovery_code') {
    await recordAudit(tenantId, { action: 'auth.mfa_recovery_code_used', actorType: 'user', actorUserId: userId, actorLabel: email?.email, ...origin });
  }
  return { tenantId, userId, permissions: await permissionsOf(tenantId, userId) };
}

export interface MfaSetup {
  secret: string;
  otpauthUri: string;
  /** An SVG QR code of otpauthUri, ready to inline. */
  qrSvg: string;
}

/** Generates a new pending secret (replacing any earlier unconfirmed one). The current secret, if any, keeps working until the new one is confirmed. */
export async function beginMfaSetup(tenantId: string, userId: string): Promise<MfaSetup> {
  const secret = generateTotpSecret();
  const user = await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.update({
      where: { id: userId },
      data: { mfaPendingSecretEncrypted: encryptSecret(secret, ENCRYPTION_KEY!) },
      select: { email: true, tenant: { select: { name: true } } },
    }),
  );
  const otpauthUri = totpKeyUri({ secret, accountName: user.email, issuer: `Seredina (${user.tenant.name})` });
  const qrSvg = await QRCode.toString(otpauthUri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, otpauthUri, qrSvg };
}

/** Confirms the pending secret with a first code from the app, turning MFA on. Returns fresh recovery codes, shown once. */
export async function confirmMfaSetup(tenantId: string, userId: string, code: string): Promise<string[]> {
  const recoveryCodes = generateRecoveryCodes();
  const enabled = await withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaPendingSecretEncrypted) throw new MfaError('Start the setup again: no pending authenticator.');
    const step = verifyTotp(decryptSecret(user.mfaPendingSecretEncrypted, ENCRYPTION_KEY!), code);
    if (step === null) return false;
    await tx.user.update({
      where: { id: userId },
      data: {
        mfaSecretEncrypted: user.mfaPendingSecretEncrypted,
        mfaPendingSecretEncrypted: null,
        mfaEnabledAt: new Date(),
        mfaLastUsedStep: step,
        mfaRecoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
      },
    });
    return true;
  });
  if (!enabled) throw new MfaError('That code is not valid. Check the time on your phone and try again.');
  return recoveryCodes;
}

/** Enrollment during sign-in, for a tenant that requires MFA. */
export async function beginMfaSetupForLogin(mfaToken: string): Promise<MfaSetup> {
  const { tenantId, userId } = readChallenge(mfaToken, 'setup');
  return beginMfaSetup(tenantId, userId);
}

export async function completeMfaSetupForLogin(
  mfaToken: string,
  code: string,
  origin: RequestOrigin,
): Promise<{ auth: AuthResult; recoveryCodes: string[] }> {
  const { tenantId, userId } = readChallenge(mfaToken, 'setup');
  const recoveryCodes = await confirmMfaSetup(tenantId, userId, code);
  await withTenantTx(prisma, tenantId, (tx) => tx.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null } }));
  const email = await withTenantTx(prisma, tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { email: true } }));
  const actor = { actorType: 'user' as const, actorUserId: userId, actorLabel: email?.email, ...origin };
  await recordAudit(tenantId, { action: 'auth.mfa_enabled', ...actor });
  await recordAudit(tenantId, { action: 'auth.login_succeeded', ...actor, metadata: { mfa: 'enrolled' } });
  return { auth: { tenantId, userId, permissions: await permissionsOf(tenantId, userId) }, recoveryCodes };
}

export async function getMfaStatus(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabledAt: true, mfaRecoveryCodeHashes: true, tenant: { select: { mfaRequired: true } } },
    });
    return {
      enabled: Boolean(user.mfaEnabledAt),
      enabledAt: user.mfaEnabledAt,
      required: user.tenant.mfaRequired,
      recoveryCodesRemaining: user.mfaRecoveryCodeHashes.length,
    };
  });
}

/** Turning MFA off asks for the password again -- a stolen session alone can't strip the second factor. */
export async function disableMfa(tenantId: string, userId: string, password: string): Promise<void> {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { tenant: { select: { mfaRequired: true } } } });
    if (user.tenant.mfaRequired) throw new MfaError('Two-factor sign-in is required in this workspace.');
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new MfaError('Wrong password.');
    await tx.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: null, mfaPendingSecretEncrypted: null, mfaEnabledAt: null, mfaLastUsedStep: null, mfaRecoveryCodeHashes: [] },
    });
  });
}

export async function regenerateRecoveryCodes(tenantId: string, userId: string, code: string): Promise<string[]> {
  const check = await checkCode(tenantId, userId, code);
  if (!check.ok) throw new MfaError('That code is not valid.');
  const recoveryCodes = generateRecoveryCodes();
  await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.update({ where: { id: userId }, data: { mfaRecoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) } }),
  );
  return recoveryCodes;
}

/** Admin action for a user who lost their phone and their recovery codes. */
export async function resetUserMfa(tenantId: string, userId: string): Promise<{ email: string }> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('user not found');
    await tx.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: null, mfaPendingSecretEncrypted: null, mfaEnabledAt: null, mfaLastUsedStep: null, mfaRecoveryCodeHashes: [] },
    });
    return { email: user.email };
  });
}

/**
 * Tenant-wide enforcement. Turning it on requires the admin to have MFA
 * themselves -- otherwise their own next sign-in would be the first to hit
 * the setup wall, which is a surprise, not a policy.
 */
export async function setMfaRequired(tenantId: string, actingUserId: string, required: boolean): Promise<void> {
  await withTenantTx(prisma, tenantId, async (tx) => {
    if (required) {
      const me = await tx.user.findUniqueOrThrow({ where: { id: actingUserId }, select: { mfaEnabledAt: true } });
      if (!me.mfaEnabledAt) throw new MfaError('Turn on two-factor sign-in for your own account first.');
    }
    await tx.tenant.update({ where: { id: tenantId }, data: { mfaRequired: required } });
  });
}
