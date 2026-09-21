-- Deliberately NOT including a DROP INDEX on kb_chunks_embedding_idx here --
-- see the kb_chunk_rag migration's own note on why `prisma migrate diff`
-- always proposes one and why it's always wrong.

-- AlterEnum
ALTER TYPE "AssetDiscoverySource" ADD VALUE 'AGENT';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "antivirus_status" TEXT,
ADD COLUMN     "cpu_model" TEXT,
ADD COLUMN     "disk_encrypted" BOOLEAN,
ADD COLUMN     "disk_summary" JSONB,
ADD COLUMN     "installed_packages" JSONB,
ADD COLUMN     "memory_total_mb" INTEGER,
ADD COLUMN     "os_version" TEXT;

-- CreateTable
CREATE TABLE "device_enrollment_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hashed_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_enrollment_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "hashed_credential" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "agent_version" TEXT,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_enrollment_tokens_hashed_token_key" ON "device_enrollment_tokens"("hashed_token");

-- CreateIndex
CREATE UNIQUE INDEX "devices_asset_id_key" ON "devices"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_hashed_credential_key" ON "devices"("hashed_credential");

-- AddForeignKey
ALTER TABLE "device_enrollment_tokens" ADD CONSTRAINT "device_enrollment_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
