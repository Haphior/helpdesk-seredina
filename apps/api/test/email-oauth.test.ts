import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import {
  buildEmailOAuthAuthorizeUrl,
  EmailOAuthGrantError,
  exchangeEmailOAuthCode,
  refreshEmailOAuthToken,
} from '@seredina/shared';
import {
  completeEmailOAuth,
  createOAuthEmailChannel,
  listEmailChannels,
  signEmailOAuthState,
  startEmailOAuth,
  verifyEmailOAuthState,
} from '../src/modules/emailchannels/service';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; body: string }[] = [];
  const impl = async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { impl, calls };
}

describe('email OAuth provider helpers', () => {
  it('builds a Google consent URL that asks for offline access', () => {
    const url = new URL(
      buildEmailOAuthAuthorizeUrl(
        { provider: 'google_oauth', clientId: 'gid' },
        { redirectUri: 'https://desk.example.com/api/email-channels/oauth/callback', state: 's1', loginHint: 'help@example.com' },
      ),
    );
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://mail.google.com/');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('login_hint')).toBe('help@example.com');
  });

  it('builds a Microsoft consent URL against the configured directory', () => {
    const url = new URL(
      buildEmailOAuthAuthorizeUrl(
        { provider: 'microsoft_oauth', clientId: 'mid', microsoftTenant: 'contoso.onmicrosoft.com' },
        { redirectUri: 'https://x/cb', state: 's' },
      ),
    );
    expect(url.host).toBe('login.microsoftonline.com');
    expect(url.pathname).toBe('/contoso.onmicrosoft.com/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toContain('IMAP.AccessAsUser.All');
    expect(url.searchParams.get('scope')).toContain('offline_access');
  });

  it('refuses a Microsoft tenant that could change the endpoint path', () => {
    expect(() =>
      buildEmailOAuthAuthorizeUrl(
        { provider: 'microsoft_oauth', clientId: 'mid', microsoftTenant: 'evil.com/../x' },
        { redirectUri: 'https://x/cb', state: 's' },
      ),
    ).toThrow(/invalid Microsoft tenant/);
  });

  it('exchanges a code and parses the token response', async () => {
    const { impl, calls } = fakeFetch(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3599 });
    const tokens = await exchangeEmailOAuthCode(
      { provider: 'google_oauth', clientId: 'gid', clientSecret: 'gsecret' },
      'the-code',
      'https://x/cb',
      impl,
    );
    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3500_000);
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(calls[0].body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('client_secret')).toBe('gsecret');
  });

  it('reports a revoked refresh token as a grant error, and a 5xx as retryable', async () => {
    const client = { provider: 'microsoft_oauth' as const, clientId: 'm', clientSecret: 's' };
    await expect(refreshEmailOAuthToken(client, 'rt', fakeFetch(400, { error: 'invalid_grant' }).impl)).rejects.toBeInstanceOf(
      EmailOAuthGrantError,
    );
    const retryable = refreshEmailOAuthToken(client, 'rt', fakeFetch(503, {}).impl);
    await expect(retryable).rejects.toThrow(/http_503/);
    await expect(retryable).rejects.not.toBeInstanceOf(EmailOAuthGrantError);
  });
});

describe('email OAuth state', () => {
  it('round-trips and rejects tampering or expiry', () => {
    const state = signEmailOAuthState({ tenantId: 't1', channelId: 'c1' });
    expect(verifyEmailOAuthState(state)).toEqual({ tenantId: 't1', channelId: 'c1', userId: null });

    const [body, sig] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ t: 'other', c: 'c1', e: Date.now() + 60_000, n: 'x' })).toString('base64url');
    expect(verifyEmailOAuthState(`${forged}.${sig}`)).toBeNull();
    expect(verifyEmailOAuthState(`${body}.AAAA`)).toBeNull();
    expect(verifyEmailOAuthState(state, Date.now() + 11 * 60 * 1000)).toBeNull();
  });
});

describe.skipIf(!hasDb)('OAuth email channels', () => {
  let tenantId: string;

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'https://desk.example.com';
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `eoauth-${tenantId.slice(0, 8)}`, name: 'Email OAuth' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  it('creates a Microsoft 365 channel with the provider servers, pending consent, and never returns secrets', async () => {
    const channel = await createOAuthEmailChannel(tenantId, {
      authType: 'microsoft_oauth',
      name: 'Soporte',
      fromAddress: 'soporte@example.com',
      clientId: 'client-123',
      clientSecret: 'super-secret-value',
      microsoftTenant: '',
    });
    expect(channel).toMatchObject({
      authType: 'microsoft_oauth',
      connectionStatus: 'pending_authorization',
      imapHost: 'outlook.office365.com',
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      imapUsername: 'soporte@example.com',
      oauthMicrosoftTenant: 'organizations',
    });

    const listed = await listEmailChannels(tenantId);
    expect(JSON.stringify(listed)).not.toContain('super-secret-value');
    expect(JSON.stringify(listed)).not.toMatch(/Encrypted/);

    // Not polled until connected.
    const active = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM list_active_email_channels()`;
    expect(active.map((r) => r.id)).not.toContain(channel.id);
  });

  it('connects a Gmail channel through the consent round trip', async () => {
    const channel = await createOAuthEmailChannel(tenantId, {
      authType: 'google_oauth',
      name: 'Gmail',
      fromAddress: 'helpdesk@example.com',
      clientId: 'gid.apps.googleusercontent.com',
      clientSecret: 'gsecret',
    });

    const authorizeUrl = new URL(await startEmailOAuth(tenantId, channel.id));
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('https://desk.example.com/api/email-channels/oauth/callback');
    const state = authorizeUrl.searchParams.get('state')!;

    const exchange = async (client: { clientSecret: string }, code: string, redirectUri: string) => {
      expect(client.clientSecret).toBe('gsecret');
      expect(code).toBe('code-from-google');
      expect(redirectUri).toBe('https://desk.example.com/api/email-channels/oauth/callback');
      return { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() + 3600_000) };
    };
    await completeEmailOAuth(state, 'code-from-google', exchange as typeof exchangeEmailOAuthCode);

    const row = await withTenantTx(prisma, tenantId, (tx) => tx.emailChannel.findUniqueOrThrow({ where: { id: channel.id } }));
    expect(row.connectionStatus).toBe('connected');
    expect(row.oauthRefreshTokenEncrypted).toBeTruthy();
    expect(row.oauthRefreshTokenEncrypted).not.toContain('refresh-1');

    const active = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM list_active_email_channels()`;
    expect(active.map((r) => r.id)).toContain(channel.id);
  });

  it('refuses a state minted for another tenant\'s channel id', async () => {
    const forged = signEmailOAuthState({ tenantId: randomUUID(), channelId: randomUUID() });
    await expect(
      completeEmailOAuth(forged, 'c', (async () => ({ accessToken: 'a', refreshToken: 'r', expiresAt: new Date() })) as never),
    ).rejects.toThrow(/not found/);
  });

  it('fails clearly when the provider returns no refresh token', async () => {
    const channel = await createOAuthEmailChannel(tenantId, {
      authType: 'google_oauth',
      name: 'Gmail 2',
      fromAddress: 'second@example.com',
      clientId: 'gid',
      clientSecret: 'gsecret',
    });
    const state = signEmailOAuthState({ tenantId, channelId: channel.id });
    await expect(
      completeEmailOAuth(state, 'c', (async () => ({ accessToken: 'a', refreshToken: null, expiresAt: new Date() })) as never),
    ).rejects.toThrow(/refresh token/);
  });
});
