import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { PERMISSIONS } from '@seredina/shared';
import jwtPlugin from '../src/plugins/jwt';
import apiKeyAuthPlugin from '../src/plugins/apiKeyAuth';
import deviceAuthPlugin from '../src/plugins/deviceAuth';
import deviceRoutes from '../src/modules/devices/routes';
import { createRole, createUser } from '../src/modules/auth/service';

/**
 * The server address + CA pinning endpoints behind the Devices page's
 * enrollment command (docs/adr/0054-server-address-and-tls.md).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const CERT = `-----BEGIN CERTIFICATE-----
MIIBszCCAVmgAwIBAgIUZ2V0LXNlcmVkaW5hLXRlc3QtY2EwCgYIKoZIzj0EAwIw
FTETMBEGA1UEAwwKVGVzdCBSb290IENBMB4XDTI2MDkyMjAwMDAwMFoXDTM2MDky
-----END CERTIFICATE-----
`;
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgc2VjcmV0LWtleS1t
-----END PRIVATE KEY-----
`;

describe.skipIf(!hasDb)('Agent setup: server address and CA pinning', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let agentToken: string;
  const dir = mkdtempSync(join(tmpdir(), 'seredina-ca-'));
  const ORIGINAL = { TLS_CA_FILE: process.env.TLS_CA_FILE, API_PUBLIC_URL: process.env.API_PUBLIC_URL };

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-jwt-secret';
    const tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `agent-setup-${tenantId.slice(0, 8)}`, name: 'Agent setup' } }),
    );
    await createRole(tenantId, { key: 'admin', name: 'Admin', permissions: [...PERMISSIONS] });
    await createRole(tenantId, { key: 'agent', name: 'Agent', permissions: ['tickets:read', 'assets:read'] });
    const admin = await createUser(tenantId, { email: 'a@example.com', name: 'A', password: 'password123', roleKey: 'admin' }, PERMISSIONS);
    const agent = await createUser(tenantId, { email: 'b@example.com', name: 'B', password: 'password123', roleKey: 'agent' }, PERMISSIONS);

    app = Fastify();
    await app.register(jwtPlugin);
    await app.register(apiKeyAuthPlugin);
    await app.register(deviceAuthPlugin);
    await app.register(deviceRoutes);
    await app.ready();
    adminToken = app.jwt.sign({ sub: admin.id, tenantId, permissions: [] });
    agentToken = app.jwt.sign({ sub: agent.id, tenantId, permissions: [] });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(ORIGINAL)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const setup = (token = adminToken) =>
    app.inject({ method: 'GET', url: '/devices/agent-setup', headers: { authorization: `Bearer ${token}` } });

  it('with no custom CA: no CA and no fingerprint', async () => {
    delete process.env.TLS_CA_FILE;
    delete process.env.API_PUBLIC_URL;
    expect((await setup()).json()).toEqual({ serverUrl: null, caCertPem: null, caCertSha256: null });
  });

  it('returns the configured address, the CA for the enrollment command, and its fingerprint', async () => {
    const caPath = join(dir, 'root.crt');
    writeFileSync(caPath, CERT);
    process.env.TLS_CA_FILE = caPath;
    process.env.API_PUBLIC_URL = 'https://helpdesk.example.com/api/';

    const info = (await setup()).json();
    expect(info.serverUrl).toBe('https://helpdesk.example.com/api');
    expect(info.caCertPem).toBe(CERT);
    expect(info.caCertSha256).toBe(createHash('sha256').update(CERT, 'utf8').digest('hex'));
  });

  it('there is no unauthenticated CA download anymore -- the CA travels in the command', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/devices/ca.pem' })).statusCode).toBe(404);
  });

  it('never hands out a file that contains a private key, even if TLS_CA_FILE points at one', async () => {
    const mixed = join(dir, 'bundle.pem');
    writeFileSync(mixed, CERT + KEY);
    process.env.TLS_CA_FILE = mixed;
    const res = await setup();
    expect(res.body).not.toContain('PRIVATE KEY');
    expect(res.json()).toMatchObject({ caCertPem: null, caCertSha256: null });

    const keyOnly = join(dir, 'key.pem');
    writeFileSync(keyOnly, KEY);
    process.env.TLS_CA_FILE = keyOnly;
    expect((await setup()).json().caCertPem).toBeNull();
  });

  it('ignores a missing or non-certificate file instead of failing', async () => {
    process.env.TLS_CA_FILE = join(dir, 'does-not-exist.pem');
    expect((await setup()).json().caCertPem).toBeNull();
    const junk = join(dir, 'junk.txt');
    writeFileSync(junk, 'hello');
    process.env.TLS_CA_FILE = junk;
    expect((await setup()).json().caCertPem).toBeNull();
  });

  it('the setup info is for people who can enroll devices (assets:manage)', async () => {
    expect((await setup(agentToken)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/devices/agent-setup' })).statusCode).toBe(401);
  });
});
