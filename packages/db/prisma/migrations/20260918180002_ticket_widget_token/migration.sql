-- Deliberately NOT including a DROP INDEX on kb_chunks_embedding_idx here --
-- see the kb_chunk_rag migration's own note on why `prisma migrate diff`
-- always proposes one and why it's always wrong.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "widget_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tickets_widget_token_key" ON "tickets"("widget_token");
