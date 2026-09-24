import nodemailer from 'nodemailer';
import type { EmailChannel } from '@seredina/db';
import { resolveMailAuth } from './credentials';

/**
 * Extracted out of send.ts (the ticket-reply email path) so
 * modules/notifications/sendEmail.ts can build the same tenant SMTP transport
 * without duplicating the credential and configuration logic. See
 * docs/adr/0022-notifications.md. OAuth channels authenticate with XOAUTH2
 * (docs/adr/0057-email-oauth.md).
 */
export async function createTransportForChannel(channel: EmailChannel) {
  const auth = await resolveMailAuth(channel, 'smtp');
  return nodemailer.createTransport({
    host: channel.smtpHost,
    port: channel.smtpPort,
    secure: channel.smtpSecure,
    // An OAuth bearer token must never cross a plaintext SMTP session, so
    // STARTTLS is mandatory for those (Microsoft's port 587). Password channels
    // keep their existing behavior.
    requireTLS: auth.kind === 'oauth' && !channel.smtpSecure,
    auth:
      auth.kind === 'oauth'
        ? { type: 'OAuth2', user: auth.user, accessToken: auth.accessToken }
        : { user: auth.user, pass: auth.pass },
  });
}

/** Where outbound mail for a ticket goes out: the channel it arrived on, else the tenant's first connected one. */
export function pickSendChannel<T extends { id: string; isActive: boolean; connectionStatus: string }>(
  channels: T[],
  preferredId: string | null | undefined,
): T | null {
  const usable = channels.filter((c) => c.isActive && c.connectionStatus === 'connected');
  return usable.find((c) => c.id === preferredId) ?? usable[0] ?? null;
}
