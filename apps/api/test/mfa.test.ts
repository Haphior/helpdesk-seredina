import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { totpCodeForStep, totpStep, verifyTotp, base32Encode } from '@seredina/shared';
import { buildApp } from '../src/index';
import { listAuditLogs } from '../src/modules/audit/service';

describe('TOTP', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC 6238 SHA-1 test vectors', () => {
    expect(totpCodeForStep(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCodeForStep(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCodeForStep(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts one step of clock drift, and never a step already used', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, totpCodeForStep(secret, step - 1), { atMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCodeForStep(secret, step - 2), { atMs: now })).toBeNull();
    expect(verifyTotp(secret, totpCodeForStep(secret, step), { atMs: now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { atMs: now })).toBeNull();
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

function currentCode(secret: string, offsetSteps = 0) {
  return totpCodeForStep(secret, totpStep() + offsetSteps);
}

describe.skipIf(!hasDb)('two-factor sign-in', () => {
  const app = buildApp();
  const slug = `mfa-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let adminToken: string;
  let secret: string;
  let recoveryCodes: string[];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  // A fresh source address per sign-in, so this suite's many sign-ins don't
  // trip the per-IP rate limit (10/min) the real routes carry.
  let ip = 0;
  const nextIp = () => `10.99.${Math.floor(++ip / 250)}.${ip % 250}`;
  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/auth/login', remoteAddress: nextIp(), payload: { tenantSlug: slug, email, password } });

  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, tenantName: 'MFA', adminEmail: 'admin@mfa.test', adminName: 'Admin', password: 'admin-password-1' },
    });
    adminToken = res.json().token;
    tenantId = app.jwt.decode<{ tenantId: string }>(adminToken)!.tenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('enrolls with a QR code and a first code, returning recovery codes once', async () => {
    const setup = await app.inject({ method: 'POST', url: '/auth/mfa/setup', headers: auth(adminToken) });
    expect(setup.statusCode).toBe(200);
    const body = setup.json();
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\/.*secret=/);
    expect(body.qrSvg).toContain('<svg');
    secret = body.secret;

    const wrong = await app.inject({ method: 'POST', url: '/auth/mfa/enable', headers: auth(adminToken), payload: { code: '000000' } });
    expect(wrong.statusCode).toBe(400);

    const ok = await app.inject({ method: 'POST', url: '/auth/mfa/enable', headers: auth(adminToken), payload: { code: currentCode(secret) } });
    expect(ok.statusCode).toBe(200);
    recoveryCodes = ok.json().recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);

    const row = await withTenantTx(prisma, tenantId, (tx) => tx.user.findFirstOrThrow({ where: { email: 'admin@mfa.test' } }));
    expect(row.mfaSecretEncrypted).not.toContain(secret);
    expect(row.mfaRecoveryCodeHashes.join()).not.toContain(recoveryCodes[0]);
  });

  it('asks for a code after the password, and issues no session until it is right', async () => {
    const first = await login('admin@mfa.test', 'admin-password-1');
    expect(first.statusCode).toBe(200);
    expect(first.json().token).toBeUndefined();
    expect(first.json().mfaRequired).toBe(true);
    const mfaToken = first.json().mfaToken;

    // The challenge token is not a session.
    const misuse = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(mfaToken) });
    expect(misuse.statusCode).toBe(401);

    const bad = await app.inject({ method: 'POST', url: '/auth/login/mfa', remoteAddress: nextIp(), payload: { mfaToken, code: '000000' } });
    expect(bad.statusCode).toBe(401);

    // The code used during enrollment was this step's, so the next one is needed now.
    const good = await app.inject({ method: 'POST', url: '/auth/login/mfa', remoteAddress: nextIp(), payload: { mfaToken, code: currentCode(secret, 1) } });
    expect(good.statusCode).toBe(200);
    expect(good.json().token).toBeTruthy();

    // Same code again: replay refused.
    const replay = await app.inject({ method: 'POST', url: '/auth/login/mfa', remoteAddress: nextIp(), payload: { mfaToken, code: currentCode(secret, 1) } });
    expect(replay.statusCode).toBe(401);
  });

  it('accepts each recovery code exactly once', async () => {
    const { mfaToken } = (await login('admin@mfa.test', 'admin-password-1')).json();
    const code = recoveryCodes[0].toUpperCase().replace(/-/g, ' ');
    const ok = await app.inject({ method: 'POST', url: '/auth/login/mfa', remoteAddress: nextIp(), payload: { mfaToken, code } });
    expect(ok.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/auth/login/mfa', remoteAddress: nextIp(), payload: { mfaToken, code } });
    expect(again.statusCode).toBe(401);

    const status = await app.inject({ method: 'GET', url: '/auth/mfa', headers: auth(adminToken) });
    expect(status.json().recoveryCodesRemaining).toBe(9);

    const used = await listAuditLogs(tenantId, { action: 'auth.mfa_recovery_code_used' });
    expect(used.entries).toHaveLength(1);
  });

  it('locks the account after repeated wrong codes, even though the password is right each time', async () => {
    await app.inject({
      method: 'POST',
      url: '/users',
      headers: auth(adminToken),
      payload: { email: 'agent@mfa.test', name: 'Agent', password: 'agent-password-1', roleKey: 'agent' },
    });
    const agentToken = (await login('agent@mfa.test', 'agent-password-1')).json().token;
    const setup = (await app.inject({ method: 'POST', url: '/auth/mfa/setup', headers: auth(agentToken) })).json();
    await app.inject({ method: 'POST', url: '/auth/mfa/enable', headers: auth(agentToken), payload: { code: currentCode(setup.secret) } });

    for (let i = 0; i < 5; i++) {
      const { mfaToken } = (await login('agent@mfa.test', 'agent-password-1')).json();
      await app.inject({ method: 'POST', url: '/auth/login/mfa', remoteAddress: nextIp(), payload: { mfaToken, code: '000000' } });
    }
    const afterLock = await login('agent@mfa.test', 'agent-password-1');
    expect(afterLock.statusCode).toBe(401);

    await app.inject({ method: 'POST', url: '/users/' + (await agentId()) + '/unlock', headers: auth(adminToken) });
  });

  async function agentId() {
    const row = await withTenantTx(prisma, tenantId, (tx) => tx.user.findFirstOrThrow({ where: { email: 'agent@mfa.test' } }));
    return row.id;
  }

  it('lets an admin reset a user who lost their phone', async () => {
    const res = await app.inject({ method: 'POST', url: `/users/${await agentId()}/mfa/reset`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(204);
    const next = await login('agent@mfa.test', 'agent-password-1');
    expect(next.json().token).toBeTruthy();
  });

  it('when the workspace requires MFA, makes an unenrolled user set it up before getting in', async () => {
    const policy = await app.inject({ method: 'PATCH', url: '/auth/mfa-policy', headers: auth(adminToken), payload: { required: true } });
    expect(policy.statusCode).toBe(200);

    const first = (await login('agent@mfa.test', 'agent-password-1')).json();
    expect(first.mfaSetupRequired).toBe(true);
    expect(first.token).toBeUndefined();

    // A setup token can't be used to skip straight to the verify step.
    const skip = await app.inject({ method: 'POST', url: '/auth/login/mfa', remoteAddress: nextIp(), payload: { mfaToken: first.mfaToken, code: '123456' } });
    expect(skip.statusCode).toBe(401);

    const setup = (await app.inject({ method: 'POST', url: '/auth/login/mfa-setup', payload: { mfaToken: first.mfaToken } })).json();
    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/login/mfa-setup/confirm',
      payload: { mfaToken: first.mfaToken, code: currentCode(setup.secret) },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().token).toBeTruthy();
    expect(confirm.json().recoveryCodes).toHaveLength(10);

    // Can't turn it off while the workspace requires it.
    const off = await app.inject({
      method: 'POST',
      url: '/auth/mfa/disable',
      headers: auth(confirm.json().token),
      payload: { password: 'agent-password-1' },
    });
    expect(off.statusCode).toBe(400);
  });
});
