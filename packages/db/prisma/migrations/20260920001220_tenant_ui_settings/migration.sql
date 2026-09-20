-- Deliberately NOT including a DROP INDEX on kb_chunks_embedding_idx here --
-- see the kb_chunk_rag migration's own note on why `prisma migrate diff`
-- always proposes one and why it's always wrong.

-- CreateTable
CREATE TABLE "tenant_ui_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "theme" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_ui_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ui_settings_tenant_id_key" ON "tenant_ui_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_ui_settings" ADD CONSTRAINT "tenant_ui_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
