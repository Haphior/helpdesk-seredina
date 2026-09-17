import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../rbac/permissions';
import { createAttachment, getAttachment, MAX_ATTACHMENT_SIZE_BYTES } from './service';

export default async function attachmentRoutes(app: FastifyInstance) {
  // Same tier as posting a reply/note (tickets:write) -- an attachment only
  // ever hangs off a Message a caller could already create.
  app.post(
    '/messages/:messageId/attachments',
    {
      preHandler: [app.authenticate, requirePermission('tickets:write')],
      // Fastify's global bodyLimit (index.ts) is 1MB for every other route --
      // this override, not the multipart plugin's own fileSize limit, is what
      // actually lets an upload up to MAX_ATTACHMENT_SIZE_BYTES reach busboy at
      // all; a little headroom over the file-size cap covers the multipart
      // boundary/headers overhead.
      bodyLimit: MAX_ATTACHMENT_SIZE_BYTES + 1024 * 1024,
    },
    async (request, reply) => {
      const { messageId } = request.params as { messageId: string };
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'no file provided' });

      const data = await file.toBuffer();
      // The multipart plugin's registered fileSize limit (index.ts) truncates the
      // stream rather than throwing -- this is the actual point a too-large
      // upload gets rejected.
      if (file.file.truncated) {
        return reply.code(400).send({ error: `attachment exceeds the ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB limit` });
      }

      try {
        const attachment = await createAttachment(request.user.tenantId, messageId, {
          filename: file.filename,
          mimeType: file.mimetype,
          data,
        });
        return reply.code(201).send(attachment);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    '/attachments/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const attachment = await getAttachment(request.user.tenantId, id);
        reply.header('Content-Type', attachment.mimeType);
        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
        return reply.send(attachment.data);
      } catch {
        return reply.code(404).send({ error: 'attachment not found' });
      }
    },
  );
}
