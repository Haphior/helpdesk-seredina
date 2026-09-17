import nodemailer from 'nodemailer';
import { decryptSecret } from '@seredina/shared';
import type { EmailChannel } from '@seredina/db';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

/**
 * Extracted out of send.ts (the ticket-reply email path) so
 * modules/notifications/sendEmail.ts can build the same tenant SMTP transport
 * without duplicating the decrypt-and-configure logic. See
 * docs/adr/0022-notifications.md.
 */
export function createTransportForChannel(channel: EmailChannel) {
  const password = decryptSecret(channel.smtpPasswordEncrypted, ENCRYPTION_KEY!);
  return nodemailer.createTransport({
    host: channel.smtpHost,
    port: channel.smtpPort,
    secure: channel.smtpSecure,
    auth: { user: channel.smtpUsername, pass: password },
  });
}
