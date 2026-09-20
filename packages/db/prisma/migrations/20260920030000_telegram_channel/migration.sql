-- Deliberately NOT including a DROP INDEX on kb_chunks_embedding_idx here --
-- see the kb_chunk_rag migration's own note on why `prisma migrate diff`
-- always proposes one and why it's always wrong.

-- CreateTable
CREATE TABLE "telegram_channels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bot_username" TEXT NOT NULL,
    "bot_token_encrypted" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_channels_tenant_id_key" ON "telegram_channels"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_channels_webhook_id_key" ON "telegram_channels"("webhook_id");

-- AddForeignKey
ALTER TABLE "telegram_channels" ADD CONSTRAINT "telegram_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
