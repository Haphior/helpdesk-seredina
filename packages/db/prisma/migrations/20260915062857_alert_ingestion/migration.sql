-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "external_id" TEXT;

-- CreateIndex
CREATE INDEX "tickets_tenant_id_channel_external_id_idx" ON "tickets"("tenant_id", "channel", "external_id");
