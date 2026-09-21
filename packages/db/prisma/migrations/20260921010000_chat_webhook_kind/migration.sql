-- Deliberately NOT including a DROP INDEX on kb_chunks_embedding_idx here --
-- see the kb_chunk_rag migration's own note on why `prisma migrate diff`
-- always proposes one and why it's always wrong.

-- AlterTable
ALTER TABLE "webhooks" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'generic',
ALTER COLUMN "secret_encrypted" DROP NOT NULL;
