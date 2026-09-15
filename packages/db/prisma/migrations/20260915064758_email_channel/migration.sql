-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "external_id" TEXT;

-- CreateTable
CREATE TABLE "email_channels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "imap_host" TEXT NOT NULL,
    "imap_port" INTEGER NOT NULL,
    "imap_secure" BOOLEAN NOT NULL DEFAULT true,
    "imap_username" TEXT NOT NULL,
    "imap_password_encrypted" TEXT NOT NULL,
    "smtp_host" TEXT NOT NULL,
    "smtp_port" INTEGER NOT NULL,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT true,
    "smtp_username" TEXT NOT NULL,
    "smtp_password_encrypted" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_polled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_tenant_id_external_id_idx" ON "messages"("tenant_id", "external_id");

-- AddForeignKey
ALTER TABLE "email_channels" ADD CONSTRAINT "email_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
