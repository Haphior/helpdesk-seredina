import { createHash, createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';

/**
 * A minimal OpenID Connect relying party (docs/adr/0062-sso-oidc.md):
 * discovery, the authorization-code flow with PKCE, and ID token validation
 * (signature against the provider's JWKS, issuer, audience, expiry, nonce).
 * Written against node:crypto rather than a client library -- it's the
 * handful of checks the spec requires, each one tested.
 */

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface OidcProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export class OidcError extends Error {}

const METADATA_TTL_MS = 60 * 60 * 1000;
const metadataCache = new Map<string, { at: number; value: OidcProviderMetadata }>();
const jwksCache = new Map<string, { at: number; keys: JsonWebKeyWithKid[] }>();

type JsonWebKeyWithKid = JsonWebKey & { kid?: string; alg?: string; use?: string };

/** For tests: forget cached discovery documents and keys. */
export function clearOidcCaches(): void {
  metadataCache.clear();
  jwksCache.clear();
}

export async function discover(issuer: string, fetchImpl: FetchLike): Promise<OidcProviderMetadata> {
  const cached = metadataCache.get(issuer);
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.value;

  const res = await fetchImpl(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!res.ok) throw new OidcError(`could not load the provider's configuration (HTTP ${res.status})`);
  const doc = (await res.json()) as Partial<OidcProviderMetadata>;
  for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[field] !== 'string' || !doc[field]) throw new OidcError(`the provider's configuration has no ${field}`);
  }
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (!doc[field]!.startsWith('https://')) throw new OidcError(`the provider's ${field} is not https`);
  }
  // Spec (OIDC Discovery 4.3): the document must be for the issuer we asked about.
  if (doc.issuer!.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) {
    throw new OidcError(`issuer mismatch: expected ${issuer}, got ${doc.issuer}`);
  }
  const value = doc as OidcProviderMetadata;
  metadataCache.set(issuer, { at: Date.now(), value });
  return value;
}

async function loadJwks(jwksUri: string, fetchImpl: FetchLike, force = false): Promise<JsonWebKeyWithKid[]> {
  const cached = jwksCache.get(jwksUri);
  if (!force && cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.keys;
  const res = await fetchImpl(jwksUri);
  if (!res.ok) throw new OidcError(`could not load the provider's signing keys (HTTP ${res.status})`);
  const body = (await res.json()) as { keys?: JsonWebKeyWithKid[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(jwksUri, { at: Date.now(), keys });
  return keys;
}

// PKCE (RFC 7636)
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildAuthorizeUrl(
  metadata: OidcProviderMetadata,
  opts: { clientId: string; redirectUri: string; state: string; nonce: string; codeVerifier: string; loginHint?: string; extra?: Record<string, string> },
): string {
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', opts.state);
  url.searchParams.set('nonce', opts.nonce);
  url.searchParams.set('code_challenge', pkceChallenge(opts.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (opts.loginHint) url.searchParams.set('login_hint', opts.loginHint);
  for (const [k, v] of Object.entries(opts.extra ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

export async function exchangeCode(
  metadata: OidcProviderMetadata,
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string },
  fetchImpl: FetchLike,
): Promise<string> {
  const res = await fetchImpl(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code_verifier: opts.codeVerifier,
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || typeof body.id_token !== 'string') {
    throw new OidcError(`the provider refused the sign-in: ${body.error_description || body.error || `HTTP ${res.status}`}`);
  }
  return body.id_token;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  preferred_username?: string;
  name?: string;
  hd?: string;
  tid?: string;
  [claim: string]: unknown;
}

const ALGORITHMS: Record<string, { hash: string; ec?: boolean }> = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  ES256: { hash: 'sha256', ec: true },
  ES384: { hash: 'sha384', ec: true },
};

const CLOCK_SKEW_S = 120;

/**
 * Validates an ID token per OIDC Core 3.1.3.7: signature (by a key from the
 * provider's JWKS, never `alg: none` or an HMAC keyed by something public),
 * issuer, audience, expiry, and nonce.
 */
export async function verifyIdToken(
  idToken: string,
  opts: { metadata: OidcProviderMetadata; clientId: string; nonce: string; nowMs?: number },
  fetchImpl: FetchLike,
): Promise<IdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('malformed ID token');
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new OidcError('malformed ID token');
  }

  const alg = header.alg ? ALGORITHMS[header.alg] : undefined;
  if (!alg) throw new OidcError(`unsupported ID token algorithm: ${header.alg}`);

  const pickKey = (keys: JsonWebKeyWithKid[]) =>
    keys.find((k) => (header.kid ? k.kid === header.kid : true) && (!k.use || k.use === 'sig') && (alg.ec ? k.kty === 'EC' : k.kty === 'RSA'));
  let jwk = pickKey(await loadJwks(opts.metadata.jwks_uri, fetchImpl));
  // Providers rotate keys; one refresh on an unknown kid.
  if (!jwk) jwk = pickKey(await loadJwks(opts.metadata.jwks_uri, fetchImpl, true));
  if (!jwk) throw new OidcError('no matching signing key for the ID token');

  const valid = cryptoVerify(
    alg.hash,
    Buffer.from(`${headerB64}.${payloadB64}`),
    alg.ec ? { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' } : createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(sigB64, 'base64url'),
  );
  if (!valid) throw new OidcError('the ID token signature is not valid');

  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (claims.iss !== opts.metadata.issuer) throw new OidcError('the ID token is from a different issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId)) throw new OidcError('the ID token is for a different application');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new OidcError('the ID token has expired');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) throw new OidcError('the ID token is not valid yet');
  if (claims.nonce !== opts.nonce) throw new OidcError('the ID token does not belong to this sign-in');
  return claims;
}
