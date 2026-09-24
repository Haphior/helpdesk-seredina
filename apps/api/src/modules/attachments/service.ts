import { prisma, withTenantTx } from '@seredina/db';
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_SIZE_BYTES } from '@seredina/shared';

export { MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_SIZE_BYTES };

export interface CreateAttachmentInput {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export async function createAttachment(tenantId: string, messageId: string, input: CreateAttachmentInput) {
  if (input.data.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`attachment exceeds the ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB limit`);
  }

  return withTenantTx(prisma, tenantId, async (tx) => {
    const message = await tx.message.findUnique({ where: { id: messageId } });
    if (!message) throw new Error('message not found');

    const existingCount = await tx.attachment.count({ where: { messageId } });
    if (existingCount >= MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new Error(`a message can have at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments`);
    }

    return tx.attachment.create({
      data: {
        tenantId,
        messageId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.data.byteLength,
        data: input.data,
      },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
  });
}

export async function getAttachment(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const attachment = await tx.attachment.findUnique({ where: { id } });
    if (!attachment) throw new Error('attachment not found');
    return attachment;
  });
}
