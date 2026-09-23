import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { buildApp } from '../src/index';
import { listAuditLogs, recordAudit } from '../src/modules/audit/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('security audit log', () => {
  const app = buildApp();
  const slug = `audit-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let adminToken: string;

  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { tenantSlug: slug, tenantName: 'Audit', adminEmail: 'admin@audit.test', adminName: 'Admin', password: 'correct-horse-1' },
    });
    expect(res.statusCode).toBe(201);
    adminToken = res.json().token;
    tenantId = app.jwt.decode<{ tenantId: string }>(adminToken)!.tenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'user-agent': 'audit-test/1.0' },
      payload: { tenantSlug: slug, email, password },
    });

  it('records registration, failed and successful sign-ins with where they came from', async () => {
    expect((await login('admin@audit.test', 'wrong-password')).statusCode).toBe(401);
    expect((await login('nobody@audit.test', 'whatever')).statusCode).toBe(401);
    expect((await login('admin@audit.test', 'correct-horse-1')).statusCode).toBe(200);

    const { entries } = await listAuditLogs(tenantId, { action: 'auth.' });
    const byAction = (a: string) => entries.filter((e) => e.action === a);

    const failed = byAction('auth.login_failed');
    expect(failed.map((e) => (e.metadata as { reason: string }).reason).sort()).toEqual(['unknown_user', 'wrong_password']);
    expect(failed.find((e) => (e.metadata as { reason: string }).reason === 'unknown_user')?.actorType).toBe('anonymous');

    const ok = byAction('auth.login_succeeded');
    expect(ok).toHaveLength(1);
    expect(ok[0].actorLabel).toBe('admin@audit.test');
    expect(ok[0].userAgent).toBe('audit-test/1.0');
    expect(ok[0].ipAddress).toBeTruthy();

    const registered = await listAuditLogs(tenantId, { action: 'tenant.registered' });
    expect(registered.entries).toHaveLength(1);
  });

  it('records the lockout after repeated wrong passwords', async () => {
    await app.inject({
      method: 'POST',
      url: '/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: 'agent@audit.test', name: 'Agent', password: 'agent-password-1', roleKey: 'agent' },
    });
    for (let i = 0; i < 5; i++) await login('agent@audit.test', 'nope');

    const locked = await listAuditLogs(tenantId, { action: 'auth.account_locked' });
    expect(locked.entries).toHaveLength(1);
    expect(locked.entries[0].targetLabel).toBe('agent@audit.test');
  });

  it('records admin actions with the acting user, and never secrets', async () => {
    const created = await listAuditLogs(tenantId, { action: 'user.created' });
    expect(created.entries[0]).toMatchObject({ actorLabel: 'admin@audit.test', targetLabel: 'agent@audit.test' });
    expect(JSON.stringify(created.entries[0].metadata)).not.toContain('agent-password-1');

    const res = await app.inject({
      method: 'PATCH',
      url: '/ai-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { provider: 'anthropic', apiKey: 'sk-ant-very-secret' },
    });
    expect(res.statusCode).toBe(200);
    const ai = await listAuditLogs(tenantId, { action: 'ai_settings.updated' });
    expect(ai.entries[0].metadata).toEqual({ provider: 'anthropic', apiKeyChanged: true });
    expect(JSON.stringify(ai.entries[0])).not.toContain('sk-ant-very-secret');
  });

  it('serves the log only to holders of audit:read', async () => {
    const asAdmin = await app.inject({ method: 'GET', url: '/audit-logs?limit=2', headers: { authorization: `Bearer ${adminToken}` } });
    expect(asAdmin.statusCode).toBe(200);
    const body = asAdmin.json();
    expect(body.entries).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: 'GET',
      url: `/audit-logs?limit=2&cursor=${body.nextCursor}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const ids = new Set([...body.entries, ...page2.json().entries].map((e: { id: string }) => e.id));
    expect(ids.size).toBe(4);

    await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.updateMany({ where: { email: 'agent@audit.test' }, data: { lockedUntil: null } }),
    );
    const agentLogin = await login('agent@audit.test', 'agent-password-1');
    const asAgent = await app.inject({
      method: 'GET',
      url: '/audit-logs',
      headers: { authorization: `Bearer ${agentLogin.json().token}` },
    });
    expect(asAgent.statusCode).toBe(403);
  });

  it('is append-only for the application role', async () => {
    await recordAudit(tenantId, { action: 'test.immutable', actorType: 'system' });
    await expect(
      withTenantTx(prisma, tenantId, (tx) => tx.auditLog.updateMany({ where: { action: 'test.immutable' }, data: { action: 'x' } })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenantTx(prisma, tenantId, (tx) => tx.auditLog.deleteMany({ where: { action: 'test.immutable' } })),
    ).rejects.toThrow(/permission denied/);
  });

  it('keeps each tenant\'s entries to itself', async () => {
    const other = randomUUID();
    await withTenantTx(prisma, other, (tx) => tx.tenant.create({ data: { id: other, slug: `audit-o-${other.slice(0, 8)}`, name: 'Other' } }));
    await recordAudit(other, { action: 'test.other_tenant', actorType: 'system' });
    const mine = await listAuditLogs(tenantId, { action: 'test.other_tenant' });
    expect(mine.entries).toHaveLength(0);
  });
});
