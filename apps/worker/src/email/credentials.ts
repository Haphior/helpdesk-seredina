import { prisma, withTenantTx, type EmailChannel } from '@seredina/db';
import {
  decryptSecret,
  emailAccessTokenIsFresh,
  encryptSecret,
  EmailOAuthGrantError,
  refreshEmailOAuthToken,
  type EmailOAuthProvider,
} from '@seredina/shared';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

export type MailAuth =
  | { kind: 'password'; user: string; pass: string }
  | { kind: 'oauth'; user: string; accessToken: string };

/** The channel can't authenticate until someone reconnects it in the console. */
export class EmailChannelNeedsReconnectError extends Error {}

type Refresh = typeof refreshEmailOAuthToken;

/**
 * IMAP and SMTP credentials for a channel. A password channel just decrypts;
 * an OAuth channel reuses its cached access token while it's fresh, otherwise
 * refreshes it and stores the new one (and Microsoft's rotated refresh token).
 * A rejected grant flips the channel to needs_reconnect, which takes it out of
 * the polling list until an admin re-consents -- see docs/adr/0057-email-oauth.md.
 */
export async function resolveMailAuth(
  channel: EmailChannel,
  which: 'imap' | 'smtp',
  refresh: Refresh = refreshEmailOAuthToken,
): Promise<MailAuth> {
  const user = which === 'imap' ? channel.imapUsername : channel.smtpUsername;

  if (channel.authType === 'password') {
    const encrypted = which === 'imap' ? channel.imapPasswordEncrypted : channel.smtpPasswordEncrypted;
    if (!encrypted) throw new Error(`email channel ${channel.id} has no ${which} password`);
    return { kind: 'password', user, pass: decryptSecret(encrypted, ENCRYPTION_KEY!) };
  }

  if (channel.connectionStatus !== 'connected' || !channel.oauthRefreshTokenEncrypted) {
    throw new EmailChannelNeedsReconnectError(`email channel ${channel.id} is not connected`);
  }

  if (channel.oauthAccessTokenEncrypted && emailAccessTokenIsFresh(channel.oauthAccessTokenExpiresAt)) {
    return { kind: 'oauth', user, accessToken: decryptSecret(channel.oauthAccessTokenEncrypted, ENCRYPTION_KEY!) };
  }

  if (!channel.oauthClientId || !channel.oauthClientSecretEncrypted) {
    throw new Error(`email channel ${channel.id} is missing its OAuth client`);
  }

  try {
    const tokens = await refresh(
      {
        provider: channel.authType as EmailOAuthProvider,
        clientId: channel.oauthClientId,
        clientSecret: decryptSecret(channel.oauthClientSecretEncrypted, ENCRYPTION_KEY!),
        microsoftTenant: channel.oauthMicrosoftTenant,
      },
      decryptSecret(channel.oauthRefreshTokenEncrypted, ENCRYPTION_KEY!),
    );

    await withTenantTx(prisma, channel.tenantId, (tx) =>
      tx.emailChannel.update({
        where: { id: channel.id },
        data: {
          oauthAccessTokenEncrypted: encryptSecret(tokens.accessToken, ENCRYPTION_KEY!),
          oauthAccessTokenExpiresAt: tokens.expiresAt,
          ...(tokens.refreshToken
            ? { oauthRefreshTokenEncrypted: encryptSecret(tokens.refreshToken, ENCRYPTION_KEY!) }
            : {}),
          lastError: null,
        },
      }),
    );
    // Keep the in-memory row current so a second call (IMAP then SMTP) doesn't refresh again.
    channel.oauthAccessTokenEncrypted = encryptSecret(tokens.accessToken, ENCRYPTION_KEY!);
    channel.oauthAccessTokenExpiresAt = tokens.expiresAt;

    return { kind: 'oauth', user, accessToken: tokens.accessToken };
  } catch (err) {
    if (err instanceof EmailOAuthGrantError) {
      await markNeedsReconnect(channel, `The mail provider rejected the saved authorization (${err.message}). Reconnect this channel.`);
      throw new EmailChannelNeedsReconnectError(err.message);
    }
    throw err;
  }
}

export async function markNeedsReconnect(channel: Pick<EmailChannel, 'id' | 'tenantId'>, reason: string): Promise<void> {
  await withTenantTx(prisma, channel.tenantId, (tx) =>
    tx.emailChannel.update({
      where: { id: channel.id },
      data: {
        connectionStatus: 'needs_reconnect',
        lastError: reason.slice(0, 500),
        oauthAccessTokenEncrypted: null,
        oauthAccessTokenExpiresAt: null,
      },
    }),
  );
}
