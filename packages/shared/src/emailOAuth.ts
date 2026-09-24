// OAuth 2.0 for email channels (docs/adr/0057-email-oauth.md). Google and
// Microsoft no longer accept a plain password for IMAP/SMTP on most accounts
// (Microsoft 365 retired Basic Auth; Google Workspace admins commonly disable
// app passwords), so a channel can instead authenticate with an access token
// (SASL XOAUTH2), refreshed from a stored refresh token.
//
// Bring-your-own OAuth app, never a Seredina-operated one -- same reasoning as
// Slack/Teams in docs/adr/0048-chat-notifications.md: each tenant registers
// its own app in Google Cloud / Microsoft Entra and pastes its client id and
// secret. Shared between apps/api (authorize + code exchange) and apps/worker
// (refresh), so the endpoints and scopes can't drift between them.

export const EMAIL_AUTH_TYPES = ['password', 'google_oauth', 'microsoft_oauth'] as const;
export type EmailAuthType = (typeof EMAIL_AUTH_TYPES)[number];
export type EmailOAuthProvider = Exclude<EmailAuthType, 'password'>;

/** `connected` is the only status the worker polls. */
export const EMAIL_CONNECTION_STATUSES = ['connected', 'pending_authorization', 'needs_reconnect'] as const;
export type EmailConnectionStatus = (typeof EMAIL_CONNECTION_STATUSES)[number];

export interface EmailServerDefaults {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  /** false = STARTTLS on a plain port (nodemailer still upgrades, and requires it for OAuth). */
  smtpSecure: boolean;
}

export const EMAIL_OAUTH_SERVER_DEFAULTS: Record<EmailOAuthProvider, EmailServerDefaults> = {
  google_oauth: {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  microsoft_oauth: {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
};

// Google: the full-mail scope is the only one IMAP/SMTP XOAUTH2 accepts.
// Microsoft: the Outlook resource's IMAP + SMTP delegated scopes, plus
// offline_access so the token response includes a refresh token.
const SCOPES: Record<EmailOAuthProvider, string> = {
  google_oauth: 'https://mail.google.com/',
  microsoft_oauth:
    'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access',
};

/**
 * Microsoft's directory segment: a tenant GUID, a verified domain, or one of
 * the well-known aliases. Validated strictly because it's interpolated into
 * the token endpoint URL -- anything else could redirect the client secret
 * to an attacker-chosen path.
 */
const MICROSOFT_TENANT_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;

export function isValidMicrosoftTenant(value: string): boolean {
  return MICROSOFT_TENANT_RE.test(value);
}

function microsoftBase(tenant: string | null | undefined): string {
  const t = tenant || 'organizations';
  if (!isValidMicrosoftTenant(t)) throw new Error('invalid Microsoft tenant');
  return `https://login.microsoftonline.com/${encodeURIComponent(t)}/oauth2/v2.0`;
}

export function emailOAuthTokenEndpoint(provider: EmailOAuthProvider, microsoftTenant?: string | null): string {
  return provider === 'google_oauth' ? 'https://oauth2.googleapis.com/token' : `${microsoftBase(microsoftTenant)}/token`;
}

export interface EmailOAuthClient {
  provider: EmailOAuthProvider;
  clientId: string;
  clientSecret: string;
  microsoftTenant?: string | null;
}

export function buildEmailOAuthAuthorizeUrl(
  client: Omit<EmailOAuthClient, 'clientSecret'>,
  opts: { redirectUri: string; state: string; loginHint?: string },
): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: SCOPES[client.provider],
    state: opts.state,
  });
  if (opts.loginHint) params.set('login_hint', opts.loginHint);

  if (client.provider === 'google_oauth') {
    // offline + consent: Google only returns a refresh token on a fresh consent.
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  params.set('response_mode', 'query');
  return `${microsoftBase(client.microsoftTenant)}/authorize?${params.toString()}`;
}

export interface EmailOAuthTokens {
  accessToken: string;
  /** Present on the initial exchange; Microsoft also rotates it on refresh. */
  refreshToken: string | null;
  expiresAt: Date;
}

/** The provider rejected the grant itself (revoked, expired, password changed) -- only a human re-consent fixes it. */
export class EmailOAuthGrantError extends Error {}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

async function tokenRequest(client: EmailOAuthClient, body: Record<string, string>, fetchImpl: FetchLike): Promise<EmailOAuthTokens> {
  const form = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...body });
  if (client.provider === 'microsoft_oauth') form.set('scope', SCOPES.microsoft_oauth);

  const res = await fetchImpl(emailOAuthTokenEndpoint(client.provider, client.microsoftTenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok || typeof data.access_token !== 'string') {
    const code = typeof data.error === 'string' ? data.error : `http_${res.status}`;
    const description = typeof data.error_description === 'string' ? `: ${data.error_description}` : '';
    // invalid_grant / invalid_client = the stored credentials are no good anymore;
    // anything else (5xx, network) is worth retrying on the next poll.
    if (code === 'invalid_grant' || code === 'invalid_client' || code === 'unauthorized_client') {
      throw new EmailOAuthGrantError(`${code}${description}`);
    }
    throw new Error(`token endpoint error ${code}${description}`);
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || 3600;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

export function exchangeEmailOAuthCode(
  client: EmailOAuthClient,
  code: string,
  redirectUri: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<EmailOAuthTokens> {
  return tokenRequest(client, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, fetchImpl);
}

export function refreshEmailOAuthToken(
  client: EmailOAuthClient,
  refreshToken: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<EmailOAuthTokens> {
  return tokenRequest(client, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl);
}

/** Refresh a minute early so a token can't expire between the check and the IMAP login. */
export function emailAccessTokenIsFresh(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(expiresAt && expiresAt.getTime() - now.getTime() > 60_000);
}
