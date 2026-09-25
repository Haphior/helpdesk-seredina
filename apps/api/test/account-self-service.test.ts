import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { buildApp } from '../src/index';
import { contactEmailQueue } from '../src/lib/queue';
import { listAuditLogs } from '../src/modules/audit/service';
import { sessionStillValid } from '../src/modules/auth/service';

describe('session validity after a password change', () => {
  it('refuses tokens from an earlier second, keeps ones from the same second', () => {
    const changedAt = new Date('2026-09-25T12:00:00.700Z');
    const sec = Math.floor(changedAt.getTime() / 1000);
    expect(sessionStillValid(null, sec - 100)).toBe(true);
    expect(sessionStillValid(changedAt, undefined)).toBe(true);
    expect(sessionStillValid(changedAt, sec - 1)).toBe(false);
    expect(sessionStillValid(changedAt, sec)).toBe(true);
    expect(sessionStillValid(changedAt, sec + 5)).toBe(true);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('account self-service', () => {
  const app = buildApp();
  const slug = `acct-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let adminToken: string;
  let ip = 0;
  const nextIp = () => `10.96.${Math.floor(++ip / 250)}.${ip % 250}`;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/auth/login', remoteAddress: nextIp(), payload: { tenantSlug: slug, email, password } });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** The link the worker would have emailed: pulled from the queued job. */
  async function linkTokenFor(email: string, path: 'reset-password' | 'accept-invite'): Promise<string> {
    const jobs = await contactEmailQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    const job = jobs
      .filter((j) => j.data.tenantId === tenantId && j.data.to === email && j.data.text.includes(`/${path}#`))
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    const match = job?.data.text.match(new RegExp(`/${path}#(\\S+)`));
    if (!match) throw new Error(`no ${path} link queued for ${email}`);
    return match[1];
  }

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'https://desk.example.com';
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, tenantName: 'Acct Co', adminEmail: 'admin@acct.test', adminName: 'Admin', password: 'admin-password-1' },
    });
    adminToken = res.json().token;
    tenantId = app.jwt.decode<{ tenantId: string }>(adminToken)!.tenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('changes your own password, and ends your other sessions but not this one', async () => {
    const other = (await login('admin@acct.test', 'admin-password-1')).json().token;
    // Sessions are compared by the second they were issued.
    await sleep(1100);

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/password',
      headers: as(adminToken),
      remoteAddress: nextIp(),
      payload: { currentPassword: 'nope-nope-1', newPassword: 'new-password-22' },
    });
    expect(wrong.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/password',
      headers: as(adminToken),
      remoteAddress: nextIp(),
      payload: { currentPassword: 'admin-password-1', newPassword: 'new-password-22' },
    });
    expect(ok.statusCode).toBe(200);
    const fresh = ok.json().token;

    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: as(other) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: as(adminToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: as(fresh) })).statusCode).toBe(200);

    expect((await login('admin@acct.test', 'admin-password-1')).statusCode).toBe(401);
    expect((await login('admin@acct.test', 'new-password-22')).statusCode).toBe(200);
    adminToken = fresh;

    const logs = await listAuditLogs(tenantId, { action: 'auth.password_changed' });
    expect(logs.entries).toHaveLength(1);
  });

  it('won’t invite anyone until an email channel is connected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: as(adminToken),
      payload: { email: 'nobody@acct.test', name: 'Nobody', invite: true, roleKey: 'agent' },
    });
    expect(res.statusCode).toBe(409);
    const users = await app.inject({ method: 'GET', url: '/users', headers: as(adminToken) });
    expect(users.json().users.map((u: { email: string }) => u.email)).not.toContain('nobody@acct.test');

    await withTenantTx(prisma, tenantId, (tx) =>
      tx.emailChannel.create({
        data: {
          tenantId,
          name: 'Support',
          fromAddress: 'support@acct.test',
          imapHost: 'imap.acct.test',
          imapPort: 993,
          imapUsername: 'support@acct.test',
          smtpHost: 'smtp.acct.test',
          smtpPort: 465,
          smtpUsername: 'support@acct.test',
          imapPasswordEncrypted: 'x',
        },
      }),
    );
  });

  it('invites someone by email; the link sets their password once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: as(adminToken),
      payload: { email: 'new.agent@acct.test', name: 'New Agent', invite: true, roleKey: 'agent' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().invitationSent).toBe(true);

    const listed = (await app.inject({ method: 'GET', url: '/users', headers: as(adminToken) })).json().users;
    expect(listed.find((u: { email: string }) => u.email === 'new.agent@acct.test').invitationPending).toBe(true);

    const token = await linkTokenFor('new.agent@acct.test', 'accept-invite');
    const info = await app.inject({ method: 'POST', url: '/auth/password/token', remoteAddress: nextIp(), payload: { token } });
    expect(info.json()).toMatchObject({ kind: 'invite', email: 'new.agent@acct.test', tenantSlug: slug });

    const set = await app.inject({ method: 'POST', url: '/auth/password/set', remoteAddress: nextIp(), payload: { token, password: 'agent-password-9' } });
    expect(set.statusCode).toBe(200);
    expect((await login('new.agent@acct.test', 'agent-password-9')).statusCode).toBe(200);

    const reused = await app.inject({ method: 'POST', url: '/auth/password/set', remoteAddress: nextIp(), payload: { token, password: 'other-password-9' } });
    expect(reused.statusCode).toBe(400);

    const after = (await app.inject({ method: 'GET', url: '/users', headers: as(adminToken) })).json().users;
    expect(after.find((u: { email: string }) => u.email === 'new.agent@acct.test').invitationPending).toBe(false);
    expect((await listAuditLogs(tenantId, { action: 'user.invite_accepted' })).entries).toHaveLength(1);
  });

  it('resets a forgotten password by email without revealing who has an account', async () => {
    const known = await app.inject({ method: 'POST', url: '/auth/password/forgot', remoteAddress: nextIp(), payload: { tenantSlug: slug, email: 'NEW.AGENT@acct.test' } });
    const unknown = await app.inject({ method: 'POST', url: '/auth/password/forgot', remoteAddress: nextIp(), payload: { tenantSlug: slug, email: 'ghost@acct.test' } });
    const noOrg = await app.inject({ method: 'POST', url: '/auth/password/forgot', remoteAddress: nextIp(), payload: { tenantSlug: 'no-such-org-x', email: 'a@b.test' } });
    expect([known.statusCode, unknown.statusCode, noOrg.statusCode]).toEqual([202, 202, 202]);

    const session = (await login('new.agent@acct.test', 'agent-password-9')).json().token;
    await sleep(1100);
    const token = await linkTokenFor('new.agent@acct.test', 'reset-password');
    const tooShort = await app.inject({ method: 'POST', url: '/auth/password/set', remoteAddress: nextIp(), payload: { token, password: 'short' } });
    expect(tooShort.statusCode).toBe(400);
    const set = await app.inject({ method: 'POST', url: '/auth/password/set', remoteAddress: nextIp(), payload: { token, password: 'reset-password-7' } });
    expect(set.statusCode).toBe(200);

    expect((await login('new.agent@acct.test', 'agent-password-9')).statusCode).toBe(401);
    expect((await login('new.agent@acct.test', 'reset-password-7')).statusCode).toBe(200);
    // Whoever had the old session is out.
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: as(session) })).statusCode).toBe(401);
    expect((await listAuditLogs(tenantId, { action: 'auth.password_reset_by_email' })).entries).toHaveLength(1);
  });

  it('caps reset emails per address', async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/auth/password/forgot', remoteAddress: nextIp(), payload: { tenantSlug: slug, email: 'admin@acct.test' } });
    }
    const jobs = await contactEmailQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs.filter((j) => j.data.tenantId === tenantId && j.data.to === 'admin@acct.test')).toHaveLength(3);
  });

  it('an admin reset also ends the user’s sessions', async () => {
    const users = (await app.inject({ method: 'GET', url: '/users', headers: as(adminToken) })).json().users;
    const agent = users.find((u: { email: string }) => u.email === 'new.agent@acct.test');
    const session = (await login('new.agent@acct.test', 'reset-password-7')).json().token;
    await sleep(1100);
    const reset = await app.inject({ method: 'POST', url: `/users/${agent.id}/reset-password`, headers: as(adminToken), payload: { password: 'admin-set-pass-1' } });
    expect(reset.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: as(session) })).statusCode).toBe(401);
  });
});
