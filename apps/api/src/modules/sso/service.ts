import { createHmac, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma, withTenantTx } from '@seredina/db';
import { assertPublicUrl, decryptSecret, encryptSecret, sha256Hex, ssrfSafeFetch, type Permission } from '@seredina/shared';
import { signPurposeToken, verifyPurposeToken } from '../../lib/purposeToken';
import { apiPublicBase } from '../../lib/publicUrl';
import { rateLimitRedis } from '../../lib/rateLimitRedis';
import { resolveTenantIdBySlug } from '../tenants/service';
import { assertCanAssignRole } from '../auth/service';
import {
  buildAuthorizeUrl,
  discover,
  exchangeCode,
  OidcError,
  verifyIdToken,
  type FetchLike,
  type IdTokenClaims,
} from './oidc';

/**
 * Single sign-on over OpenID Connect -- docs/adr/0062-sso-oidc.md.
 *
 * GET /auth/sso/start -> the IdP -> GET /auth/sso/callback -> the console at
 * /login/sso#<one-time exchange token> -> POST /auth/sso/exchange -> session.
 * The session token itself never appears in a URL.
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

export const SSO_PROVIDERS = ['microsoft', 'google', 'oidc'] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];

const GOOGLE_ISSUER = 'https://accounts.google.com';
const MICROSOFT_DIRECTORY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SsoError extends Error {}

/** The issuer URL a stored setting stands for. Microsoft is pinned to one directory, never 'common'. */
export function issuerFor(provider: SsoProvider, issuer: string): string {
  if (provider === 'google') return GOOGLE_ISSUER;
  if (provider === 'microsoft') {
    if (!MICROSOFT_DIRECTORY_RE.test(issuer)) throw new SsoError('The Microsoft directory (tenant) ID must be a GUID.');
    return `https://login.microsoftonline.com/${issuer.toLowerCase()}/v2.0`;
  }
  return issuer.replace(/\/$/, '');
}

/**
 * Microsoft and Google endpoints are fixed public hosts. A generic issuer is
 * tenant-supplied, so in cloud mode every fetch to it goes through the SSRF
 * guard; a self-hosted operator may point at an internal IdP (Keycloak,
 * Authentik...) on their own network -- same policy as the AI base URL.
 */
function fetchFor(provider: SsoProvider): FetchLike {
  if (provider === 'oidc' && process.env.SEREDINA_MODE !== 'self_hosted') return ssrfSafeFetch as unknown as FetchLike;
  return fetch as unknown as FetchLike;
}

export function ssoRedirectUri(): string | null {
  const base = apiPublicBase();
  return base ? `${base}/auth/sso/callback` : null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SsoSettingsView {
  configured: boolean;
  enabled: boolean;
  provider: SsoProvider | null;
  issuer: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRoleKey: string;
  enforced: boolean;
  redirectUri: string | null;
}

export async function getSsoSettings(tenantId: string): Promise<SsoSettingsView> {
  const row = await withTenantTx(prisma, tenantId, (tx) => tx.tenantSsoSettings.findUnique({ where: { tenantId } }));
  return {
    configured: Boolean(row),
    enabled: row?.enabled ?? false,
    provider: (row?.provider as SsoProvider) ?? null,
    issuer: row?.issuer ?? null,
    clientId: row?.clientId ?? null,
    hasClientSecret: Boolean(row?.clientSecretEncrypted),
    allowedDomains: row?.allowedDomains ?? [],
    autoProvision: row?.autoProvision ?? false,
    defaultRoleKey: row?.defaultRoleKey ?? 'agent',
    enforced: row?.enforced ?? false,
    redirectUri: ssoRedirectUri(),
  };
}

export interface SsoSettingsInput {
  enabled: boolean;
  provider: SsoProvider;
  issuer: string;
  clientId: string;
  /** Omitted = keep the stored one. */
  clientSecret?: string;
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRoleKey: string;
  enforced: boolean;
}

export async function saveSsoSettings(tenantId: string, input: SsoSettingsInput, callerPermissions: readonly Permission[]) {
  const issuer = input.provider === 'google' ? GOOGLE_ISSUER : input.issuer.trim();
  const resolvedIssuer = issuerFor(input.provider, issuer);
  if (input.provider === 'oidc') {
    if (!resolvedIssuer.startsWith('https://')) throw new SsoError('The issuer URL must start with https://');
    if (process.env.SEREDINA_MODE !== 'self_hosted') {
      await assertPublicUrl(resolvedIssuer).catch((err: Error) => {
        throw new SsoError(`The issuer URL isn't reachable as a public address: ${err.message}`);
      });
    }
  }
  if (input.enforced && !input.enabled) throw new SsoError('Turn single sign-on on before requiring it.');
  const allowedDomains = [...new Set(input.allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];

  await withTenantTx(prisma, tenantId, async (tx) => {
    const role = await tx.role.findUnique({
      where: { tenantId_key: { tenantId, key: input.defaultRoleKey } },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) throw new SsoError('That default role does not exist.');
    // Auto-provisioning hands this role to anyone the IdP vouches for -- no
    // more than the admin configuring it could hand out themselves.
    if (input.autoProvision) {
      try {
        assertCanAssignRole(role.permissions.map((p) => p.permission.key), callerPermissions);
      } catch (err) {
        throw new SsoError((err as Error).message);
      }
    }

    const existing = await tx.tenantSsoSettings.findUnique({ where: { tenantId } });
    if (!existing && !input.clientSecret) throw new SsoError('The client secret is required.');
    const data = {
      enabled: input.enabled,
      provider: input.provider,
      issuer,
      clientId: input.clientId.trim(),
      ...(input.clientSecret ? { clientSecretEncrypted: encryptSecret(input.clientSecret, ENCRYPTION_KEY!) } : {}),
      allowedDomains,
      autoProvision: input.autoProvision,
      defaultRoleKey: input.defaultRoleKey,
      enforced: input.enforced,
    };
    if (existing) await tx.tenantSsoSettings.update({ where: { tenantId }, data });
    else await tx.tenantSsoSettings.create({ data: { tenantId, ...data, clientSecretEncrypted: data.clientSecretEncrypted! } });
  });
  return getSsoSettings(tenantId);
}

export async function deleteSsoSettings(tenantId: string): Promise<void> {
  await withTenantTx(prisma, tenantId, (tx) => tx.tenantSsoSettings.deleteMany({ where: { tenantId } }));
}

/** Password sign-in is refused for non-admins while SSO is enforced -- see auth/service.ts login(). */
export async function isSsoEnforced(tenantId: string): Promise<boolean> {
  const row = await withTenantTx(prisma, tenantId, (tx) =>
    tx.tenantSsoSettings.findUnique({ where: { tenantId }, select: { enabled: true, enforced: true } }),
  );
  return Boolean(row?.enabled && row.enforced);
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

const STATE_PURPOSE = 'sso-state';
const STATE_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_PURPOSE = 'sso-exchange';
const EXCHANGE_TTL_MS = 60 * 1000;

interface StatePayload {
  t: string; // tenant
  n: string; // nonce -- also seeds the PKCE verifier
}

/**
 * The PKCE verifier is derived from the state's nonce with a server-side
 * key, so nothing has to be stored between start and callback, and the
 * verifier itself never leaves the server (the IdP only sees its hash).
 */
function codeVerifierFor(nonce: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is required');
  return createHmac('sha256', secret).update(`seredina:sso-pkce:v1:${nonce}`).digest('base64url');
}

async function loadConfig(tenantId: string, fetchOverride?: FetchLike) {
  const row = await withTenantTx(prisma, tenantId, (tx) => tx.tenantSsoSettings.findUnique({ where: { tenantId } }));
  if (!row || !row.enabled) throw new SsoError('Single sign-on is not set up for this workspace.');
  const provider = row.provider as SsoProvider;
  const fetchImpl = fetchOverride ?? fetchFor(provider);
  const metadata = await discover(issuerFor(provider, row.issuer), fetchImpl);
  return { row, provider, fetchImpl, metadata };
}

/** Step 1: where to send the browser. */
export async function startSso(tenantSlug: string, loginHint?: string, fetchOverride?: FetchLike): Promise<string> {
  const tenantId = await resolveTenantIdBySlug(tenantSlug);
  if (!tenantId) throw new SsoError('Single sign-on is not set up for this workspace.');
  const redirectUri = ssoRedirectUri();
  if (!redirectUri) throw new SsoError('The server has no public address configured (WEB_ORIGIN).');

  const { row, provider, metadata } = await loadConfig(tenantId, fetchOverride);
  const nonce = randomBytes(16).toString('base64url');
  const state = signPurposeToken<StatePayload>(STATE_PURPOSE, { t: tenantId, n: nonce }, STATE_TTL_MS);
  const extra: Record<string, string> = {};
  // Google: restrict the account chooser to the workspace domain when there's exactly one.
  if (provider === 'google' && row.allowedDomains.length === 1) extra.hd = row.allowedDomains[0];
  return buildAuthorizeUrl(metadata, {
    clientId: row.clientId,
    redirectUri,
    state,
    nonce,
    codeVerifier: codeVerifierFor(nonce),
    loginHint,
    extra,
  });
}

export interface SsoIdentity {
  email: string;
  name: string;
  subject: string;
}

/** Which email the IdP vouches for, and whether it may sign in here. */
export function identityFromClaims(provider: SsoProvider, claims: IdTokenClaims, allowedDomains: string[]): SsoIdentity {
  let email: string | undefined;
  if (provider === 'microsoft') {
    // The directory is pinned (issuerFor), so its own accounts' UPN is trustworthy.
    email = claims.email ?? claims.preferred_username;
  } else {
    if (claims.email_verified === false || claims.email_verified === 'false') {
      throw new SsoError('Your identity provider has not verified your email address.');
    }
    if (provider === 'google' && claims.email_verified !== true && claims.email_verified !== 'true') {
      throw new SsoError('Your identity provider has not verified your email address.');
    }
    email = claims.email;
  }
  if (!email || !email.includes('@')) throw new SsoError('Your identity provider did not share an email address.');
  email = email.toLowerCase();

  const domain = email.split('@')[1];
  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    throw new SsoError(`Accounts from ${domain} can't sign in to this workspace.`);
  }
  if (provider === 'google' && allowedDomains.length > 0 && claims.hd && !allowedDomains.includes(String(claims.hd).toLowerCase())) {
    throw new SsoError(`Accounts from ${claims.hd} can't sign in to this workspace.`);
  }
  return { email, name: typeof claims.name === 'string' && claims.name ? claims.name : email, subject: claims.sub };
}

export interface SsoResult {
  tenantId: string;
  userId: string | null;
  email: string | null;
  provisioned: boolean;
}

/** Step 2: the IdP sent the browser back. Returns who signed in (or throws with a reason to show). */
export async function completeSso(state: string, code: string, fetchOverride?: FetchLike): Promise<SsoResult> {
  const payload = verifyPurposeToken<StatePayload>(STATE_PURPOSE, state);
  if (!payload) throw new SsoError('The sign-in link expired. Try again.');
  const tenantId = payload.t;
  const redirectUri = ssoRedirectUri();
  if (!redirectUri) throw new SsoError('The server has no public address configured (WEB_ORIGIN).');
  const { row, provider, fetchImpl, metadata } = await loadConfig(tenantId, fetchOverride);

  const idToken = await exchangeCode(
    metadata,
    {
      clientId: row.clientId,
      clientSecret: decryptSecret(row.clientSecretEncrypted, ENCRYPTION_KEY!),
      code,
      redirectUri,
      codeVerifier: codeVerifierFor(payload.n),
    },
    fetchImpl,
  );
  const claims = await verifyIdToken(idToken, { metadata, clientId: row.clientId, nonce: payload.n }, fetchImpl);
  const identity = identityFromClaims(provider, claims, row.allowedDomains);

  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.user.findFirst({ where: { email: { equals: identity.email, mode: 'insensitive' } } });
    if (existing) {
      if (!existing.isActive) throw new SsoError('Your account in this workspace is deactivated.');
      if (existing.lockedUntil && existing.lockedUntil > new Date()) throw new SsoError('Your account is temporarily locked.');
      return { tenantId, userId: existing.id, email: existing.email, provisioned: false };
    }
    if (!row.autoProvision) {
      throw new SsoError(`There's no account for ${identity.email} in this workspace. Ask an admin to add you.`);
    }
    const role = await tx.role.findUnique({ where: { tenantId_key: { tenantId, key: row.defaultRoleKey } } });
    if (!role) throw new SsoError('The default role for new accounts no longer exists. Ask an admin to fix the SSO settings.');
    // No usable password: this account signs in through the IdP (an admin can
    // still set one from the Users page if they ever need to).
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const user = await tx.user.create({ data: { tenantId, email: identity.email, name: identity.name, passwordHash, roleId: role.id } });
    return { tenantId, userId: user.id, email: user.email, provisioned: true };
  });
}

/** The one-time token the console trades for a session (so the session token never appears in a URL). */
export function issueSsoExchangeToken(result: SsoResult): string {
  return signPurposeToken(EXCHANGE_PURPOSE, { t: result.tenantId, u: result.userId, j: randomBytes(8).toString('hex') }, EXCHANGE_TTL_MS);
}

export async function redeemSsoExchangeToken(token: string): Promise<{ tenantId: string; userId: string } | null> {
  const payload = verifyPurposeToken<{ t: string; u: string }>(EXCHANGE_PURPOSE, token);
  if (!payload) return null;
  // Single use, across API replicas.
  const first = await rateLimitRedis.set(`seredina:sso-exchange:${sha256Hex(token)}`, '1', 'PX', EXCHANGE_TTL_MS * 2, 'NX');
  if (first !== 'OK') return null;
  return { tenantId: payload.t, userId: payload.u };
}

export { OidcError };
