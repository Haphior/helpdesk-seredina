-- Deliberately NOT including a DROP INDEX on kb_chunks_embedding_idx here --
-- see the kb_chunk_rag migration's own note on why `prisma migrate diff`
-- always proposes one and why it's always wrong.

-- CreateTable
CREATE TABLE "csat_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "csat_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "csat_responses_ticket_id_key" ON "csat_responses"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "csat_responses_token_key" ON "csat_responses"("token");

-- AddForeignKey
ALTER TABLE "csat_responses" ADD CONSTRAINT "csat_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_responses" ADD CONSTRAINT "csat_responses_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
