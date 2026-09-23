import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import {
  buildEmailOAuthAuthorizeUrl,
  decryptSecret,
  EMAIL_OAUTH_SERVER_DEFAULTS,
  encryptSecret,
  exchangeEmailOAuthCode,
  type EmailOAuthProvider,
} from '@seredina/shared';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

// Never select the *Encrypted columns back out -- there is no legitimate reason for
// the API response to include even the ciphertext, let alone a plaintext password.
const SAFE_SELECT = {
  id: true,
  name: true,
  fromAddress: true,
  imapHost: true,
  imapPort: true,
  imapSecure: true,
  imapUsername: true,
  smtpHost: true,
  smtpPort: true,
  smtpSecure: true,
  smtpUsername: true,
  isActive: true,
  lastPolledAt: true,
  createdAt: true,
  authType: true,
  connectionStatus: true,
  lastError: true,
  oauthClientId: true,
  oauthMicrosoftTenant: true,
} as const;

export interface EmailChannelInput {
  name: string;
  fromAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
}

export interface OAuthEmailChannelInput {
  authType: EmailOAuthProvider;
  name: string;
  fromAddress: string;
  clientId: string;
  clientSecret: string;
  microsoftTenant?: string | null;
}

export async function createEmailChannel(tenantId: string, input: EmailChannelInput) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.emailChannel.create({
      data: {
        tenantId,
        name: input.name,
        fromAddress: input.fromAddress,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        imapSecure: input.imapSecure,
        imapUsername: input.imapUsername,
        imapPasswordEncrypted: encryptSecret(input.imapPassword, ENCRYPTION_KEY!),
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpSecure: input.smtpSecure,
        smtpUsername: input.smtpUsername,
        smtpPasswordEncrypted: encryptSecret(input.smtpPassword, ENCRYPTION_KEY!),
      },
      select: SAFE_SELECT,
    }),
  );
}

/**
 * Gmail / Microsoft 365 channel (docs/adr/0055-email-oauth.md). Server
 * settings are the provider's fixed ones and the mailbox address is the login,
 * so all the admin supplies is their own OAuth app's client id and secret. The
 * channel starts in pending_authorization -- the worker skips it until the
 * consent round trip (startEmailOAuth -> completeEmailOAuth) stores a refresh token.
 */
export async function createOAuthEmailChannel(tenantId: string, input: OAuthEmailChannelInput) {
  const server = EMAIL_OAUTH_SERVER_DEFAULTS[input.authType];
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.emailChannel.create({
      data: {
        tenantId,
        name: input.name,
        fromAddress: input.fromAddress,
        ...server,
        imapUsername: input.fromAddress,
        smtpUsername: input.fromAddress,
        authType: input.authType,
        connectionStatus: 'pending_authorization',
        oauthClientId: input.clientId,
        oauthClientSecretEncrypted: encryptSecret(input.clientSecret, ENCRYPTION_KEY!),
        oauthMicrosoftTenant: input.authType === 'microsoft_oauth' ? input.microsoftTenant || 'organizations' : null,
      },
      select: SAFE_SELECT,
    }),
  );
}

export async function listEmailChannels(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.emailChannel.findMany({ select: SAFE_SELECT, orderBy: { name: 'asc' } }),
  );
}

export async function deleteEmailChannel(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.emailChannel.findUnique({ where: { id } });
    if (!existing) throw new Error('email channel not found');
    await tx.emailChannel.delete({ where: { id } });
  });
}

// ---------------------------------------------------------------------------
// OAuth consent round trip
// ---------------------------------------------------------------------------

/**
 * The redirect URI the admin registers in their Google/Microsoft app. The
 * console and API share one address with the API under /api
 * (docs/adr/0054-server-address-and-tls.md), so WEB_ORIGIN + /api works when
 * API_PUBLIC_URL isn't set.
 */
export function emailOAuthRedirectUri(): string | null {
  const base = process.env.API_PUBLIC_URL?.replace(/\/$/, '') || (process.env.WEB_ORIGIN ? `${process.env.WEB_ORIGIN.replace(/\/$/, '')}/api` : null);
  return base ? `${base}/email-channels/oauth/callback` : null;
}

/** Where the callback sends the browser back to. */
export function emailChannelsConsoleUrl(result: { connected: true } | { error: string }): string {
  const origin = (process.env.WEB_ORIGIN ?? '').replace(/\/$/, '');
  const qs = 'connected' in result ? 'oauth=connected' : `oauth_error=${encodeURIComponent(result.error)}`;
  return `${origin}/email-channels?${qs}`;
}

const STATE_TTL_MS = 10 * 60 * 1000;

// Own HMAC key derived from JWT_SECRET with a purpose label, rather than
// signing the state as a JWT: a JWT signed with the session key would also
// pass app.authenticate's signature check.
function stateKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is required');
  return createHmac('sha256', secret).update('seredina:email-oauth-state:v1').digest();
}

export interface EmailOAuthState {
  tenantId: string;
  channelId: string;
  /** Who started the connection -- for the audit entry the callback writes. */
  userId?: string | null;
}

export function signEmailOAuthState(payload: EmailOAuthState, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({
      t: payload.tenantId,
      c: payload.channelId,
      u: payload.userId ?? null,
      e: now + STATE_TTL_MS,
      n: randomBytes(8).toString('hex'),
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyEmailOAuthState(state: string, now = Date.now()): EmailOAuthState | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', stateKey()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { t: string; c: string; u?: string | null; e: number };
    if (typeof data.e !== 'number' || data.e < now) return null;
    return { tenantId: data.t, channelId: data.c, userId: data.u ?? null };
  } catch {
    return null;
  }
}

export class EmailOAuthSetupError extends Error {}

/** Step 1: the URL to send the admin's browser to. Also how a needs_reconnect channel is reconnected. */
export async function startEmailOAuth(tenantId: string, channelId: string, userId?: string): Promise<string> {
  const redirectUri = emailOAuthRedirectUri();
  if (!redirectUri) throw new EmailOAuthSetupError('Set WEB_ORIGIN or API_PUBLIC_URL so the provider knows where to send you back.');

  const channel = await withTenantTx(prisma, tenantId, (tx) => tx.emailChannel.findUnique({ where: { id: channelId } }));
  if (!channel) throw new EmailOAuthSetupError('email channel not found');
  if (channel.authType === 'password' || !channel.oauthClientId) {
    throw new EmailOAuthSetupError('this channel uses a password, not OAuth');
  }

  return buildEmailOAuthAuthorizeUrl(
    { provider: channel.authType as EmailOAuthProvider, clientId: channel.oauthClientId, microsoftTenant: channel.oauthMicrosoftTenant },
    { redirectUri, state: signEmailOAuthState({ tenantId, channelId, userId }), loginHint: channel.fromAddress },
  );
}

/** Step 2: the provider redirected back with a code; trade it for tokens and mark the channel connected. */
export async function completeEmailOAuth(
  state: string,
  code: string,
  exchange: typeof exchangeEmailOAuthCode = exchangeEmailOAuthCode,
): Promise<EmailOAuthState & { fromAddress: string }> {
  const verified = verifyEmailOAuthState(state);
  if (!verified) throw new EmailOAuthSetupError('The sign-in link expired or was tampered with. Start again from the console.');
  const redirectUri = emailOAuthRedirectUri();
  if (!redirectUri) throw new EmailOAuthSetupError('redirect URI is not configured');

  const channel = await withTenantTx(prisma, verified.tenantId, (tx) =>
    tx.emailChannel.findUnique({ where: { id: verified.channelId } }),
  );
  if (!channel || channel.authType === 'password' || !channel.oauthClientId || !channel.oauthClientSecretEncrypted) {
    throw new EmailOAuthSetupError('email channel not found');
  }

  const tokens = await exchange(
    {
      provider: channel.authType as EmailOAuthProvider,
      clientId: channel.oauthClientId,
      clientSecret: decryptSecret(channel.oauthClientSecretEncrypted, ENCRYPTION_KEY!),
      microsoftTenant: channel.oauthMicrosoftTenant,
    },
    code,
    redirectUri,
  );
  if (!tokens.refreshToken) {
    throw new EmailOAuthSetupError(
      'The provider did not return a refresh token. For Google, remove Seredina under your account\'s third-party access and try again.',
    );
  }

  await withTenantTx(prisma, verified.tenantId, (tx) =>
    tx.emailChannel.update({
      where: { id: channel.id },
      data: {
        connectionStatus: 'connected',
        lastError: null,
        oauthRefreshTokenEncrypted: encryptSecret(tokens.refreshToken!, ENCRYPTION_KEY!),
        oauthAccessTokenEncrypted: encryptSecret(tokens.accessToken, ENCRYPTION_KEY!),
        oauthAccessTokenExpiresAt: tokens.expiresAt,
      },
    }),
  );
  return { ...verified, fromAddress: channel.fromAddress };
}
