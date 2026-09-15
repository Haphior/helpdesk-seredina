import { prisma, withTenantTx } from '@seredina/db';
import { encryptSecret } from '@seredina/shared';

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
