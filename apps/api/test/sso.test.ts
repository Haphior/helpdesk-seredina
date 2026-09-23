import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { encryptSecret } from '@seredina/shared';
import { buildApp } from '../src/index';
import { clearOidcCaches, discover, verifyIdToken, type FetchLike } from '../src/modules/sso/oidc';
import { completeSso, identityFromClaims, redeemSsoExchangeToken, issueSsoExchangeToken, saveSsoSettings, startSso } from '../src/modules/sso/service';

// A fake identity provider: real RSA keys, a real JWKS, real signatures.
const ISSUER = 'https://idp.example.test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
const metadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
};

function signJwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = header.alg === 'none' ? '' : sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

function baseClaims(nonce: string, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: 'client-1', sub: 'user-sub', exp: now + 300, iat: now, nonce, email: 'ana@acme.test', email_verified: true, name: 'Ana', ...overrides };
}

/** Serves discovery, JWKS and the token endpoint; the token endpoint checks PKCE and signs an ID token. */
function fakeIdp(claimsFor: (nonce: string) => Record<string, unknown>) {
  const pending = new Map<string, { nonce: string; challenge: string }>();
  const fetchImpl: FetchLike = async (url, init) => {
    const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (url === `${ISSUER}/.well-known/openid-configuration`) return json(metadata);
    if (url === `${ISSUER}/jwks`) return json({ keys: [jwk] });
    if (url === `${ISSUER}/token`) {
      const form = new URLSearchParams(init?.body);
      const entry = pending.get(form.get('code')!);
      if (!entry) return json({ error: 'invalid_grant' }, 400);
      const challenge = createHash('sha256').update(form.get('code_verifier')!).digest('base64url');
      if (challenge !== entry.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE mismatch' }, 400);
      return json({ id_token: signJwt(claimsFor(entry.nonce)) });
    }
    return json({}, 404);
  };
  /** What the IdP does when the browser arrives at the authorize URL: remember the request, hand back a code. */
  const authorize = (authorizeUrl: string) => {
    const u = new URL(authorizeUrl);
    const code = randomUUID();
    pending.set(code, { nonce: u.searchParams.get('nonce')!, challenge: u.searchParams.get('code_challenge')! });
    return { code, state: u.searchParams.get('state')! };
  };
  return { fetchImpl, authorize };
}

describe('OIDC ID token validation', () => {
  const idp = fakeIdp((n) => baseClaims(n));

  it('accepts a correctly signed token for this client and nonce', async () => {
    clearOidcCaches();
    const md = await discover(ISSUER, idp.fetchImpl);
    const claims = await verifyIdToken(signJwt(baseClaims('n1')), { metadata: md, clientId: 'client-1', nonce: 'n1' }, idp.fetchImpl);
    expect(claims.email).toBe('ana@acme.test');
  });

  it.each([
    ['another audience', baseClaims('n1', { aud: 'someone-else' }), /different application/],
    ['another issuer', baseClaims('n1', { iss: 'https://evil.test' }), /different issuer/],
    ['an expired token', baseClaims('n1', { exp: Math.floor(Date.now() / 1000) - 3600 }), /expired/],
    ['another sign-in\'s nonce', baseClaims('other'), /does not belong/],
  ])('rejects %s', async (_label, claims, message) => {
    await expect(verifyIdToken(signJwt(claims), { metadata, clientId: 'client-1', nonce: 'n1' }, idp.fetchImpl)).rejects.toThrow(message);
  });

  it('rejects unsigned and tampered tokens', async () => {
    const unsigned = signJwt(baseClaims('n1'), { alg: 'none' });
    await expect(verifyIdToken(unsigned, { metadata, clientId: 'client-1', nonce: 'n1' }, idp.fetchImpl)).rejects.toThrow(/unsupported/);

    const [h, , s] = signJwt(baseClaims('n1')).split('.');
    const forged = Buffer.from(JSON.stringify(baseClaims('n1', { email: 'admin@acme.test' }))).toString('base64url');
    await expect(verifyIdToken(`${h}.${forged}.${s}`, { metadata, clientId: 'client-1', nonce: 'n1' }, idp.fetchImpl)).rejects.toThrow(
      /signature/,
    );
  });

  it('refuses a discovery document that claims another issuer', async () => {
    clearOidcCaches();
    const liar: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ ...metadata, issuer: 'https://other.test' }) });
    await expect(discover(ISSUER, liar)).rejects.toThrow(/issuer mismatch/);
  });
});

describe('SSO identity rules', () => {
  it('enforces the domain allowlist and verified email', () => {
    expect(identityFromClaims('oidc', baseClaims('n') as never, ['acme.test']).email).toBe('ana@acme.test');
    expect(() => identityFromClaims('oidc', baseClaims('n') as never, ['other.test'])).toThrow(/can't sign in/);
    expect(() => identityFromClaims('oidc', baseClaims('n', { email_verified: false }) as never, [])).toThrow(/not verified/);
    expect(() => identityFromClaims('google', baseClaims('n', { email_verified: undefined }) as never, [])).toThrow(/not verified/);
    // Microsoft: pinned directory, UPN as the email.
    expect(identityFromClaims('microsoft', baseClaims('n', { email: undefined, preferred_username: 'Ana@Acme.test' }) as never, []).email).toBe(
      'ana@acme.test',
    );
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('SSO sign-in', () => {
  const app = buildApp();
  const slug = `sso-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let adminToken: string;
  let ip = 0;
  const nextIp = () => `10.96.${Math.floor(++ip / 250)}.${ip % 250}`;

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'https://desk.example.com';
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, tenantName: 'SSO', adminEmail: 'admin@acme.test', adminName: 'Admin', password: 'admin-password-1' },
    });
    adminToken = res.json().token;
    tenantId = app.jwt.decode<{ tenantId: string }>(adminToken)!.tenantId;
    await app.inject({
      method: 'POST',
      url: '/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: 'ana@acme.test', name: 'Ana', password: 'ana-password-1', roleKey: 'agent' },
    });
    // Stored directly: saveSsoSettings would (correctly) refuse a non-resolvable issuer in cloud mode.
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenantSsoSettings.create({
        data: {
          tenantId,
          enabled: true,
          provider: 'oidc',
          issuer: ISSUER,
          clientId: 'client-1',
          clientSecretEncrypted: encryptSecret('secret-1', process.env.ENCRYPTION_KEY!),
          allowedDomains: ['acme.test'],
        },
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function signInAs(email: string) {
    clearOidcCaches();
    const idp = fakeIdp((nonce) => baseClaims(nonce, { email }));
    const { code, state } = idp.authorize(await startSso(slug, undefined, idp.fetchImpl));
    return completeSso(state, code, idp.fetchImpl);
  }

  it('signs in an existing user, and the exchange token works exactly once', async () => {
    const result = await signInAs('Ana@acme.test');
    expect(result.provisioned).toBe(false);
    expect(result.email).toBe('ana@acme.test');

    const exchange = issueSsoExchangeToken(result);
    const first = await app.inject({ method: 'POST', url: '/auth/sso/exchange', remoteAddress: nextIp(), payload: { token: exchange } });
    expect(first.statusCode).toBe(200);
    const session = first.json().token;
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${session}` } })).json().email).toBe(
      'ana@acme.test',
    );
    expect(await redeemSsoExchangeToken(exchange)).toBeNull();
  });

  it('refuses an unknown account unless auto-provisioning is on', async () => {
    await expect(signInAs('new.person@acme.test')).rejects.toThrow(/no account/);

    await withTenantTx(prisma, tenantId, (tx) => tx.tenantSsoSettings.update({ where: { tenantId }, data: { autoProvision: true } }));
    const result = await signInAs('new.person@acme.test');
    expect(result.provisioned).toBe(true);
    const user = await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.findFirstOrThrow({ where: { email: 'new.person@acme.test' }, include: { role: true } }),
    );
    expect(user.role?.key).toBe('agent');
  });

  it('refuses a domain outside the allowlist', async () => {
    await expect(signInAs('someone@gmail.test')).rejects.toThrow(/can't sign in/);
  });

  it('when enforced, refuses password sign-in for everyone but admins', async () => {
    await withTenantTx(prisma, tenantId, (tx) => tx.tenantSsoSettings.update({ where: { tenantId }, data: { enforced: true } }));
    const agent = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, email: 'ana@acme.test', password: 'ana-password-1' },
    });
    expect(agent.statusCode).toBe(403);
    expect(agent.json().ssoRequired).toBe(true);

    // Wrong password still looks like any other wrong password.
    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, email: 'ana@acme.test', password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);

    const admin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, email: 'admin@acme.test', password: 'admin-password-1' },
    });
    expect(admin.statusCode).toBe(200);
  });

  it('never returns the client secret, and won\'t auto-provision a role above the admin\'s own', async () => {
    const res = await app.inject({ method: 'GET', url: '/sso-settings', headers: { authorization: `Bearer ${adminToken}` } });
    expect(res.json()).toMatchObject({ enabled: true, hasClientSecret: true, redirectUri: 'https://desk.example.com/api/auth/sso/callback' });
    expect(JSON.stringify(res.json())).not.toContain('secret-1');

    await expect(
      saveSsoSettings(
        tenantId,
        { enabled: true, provider: 'microsoft', issuer: randomUUID(), clientId: 'c', allowedDomains: [], autoProvision: true, defaultRoleKey: 'admin', enforced: false },
        ['tickets:read', 'users:manage'],
      ),
    ).rejects.toThrow(/permissions you don't have/);
  });
});
