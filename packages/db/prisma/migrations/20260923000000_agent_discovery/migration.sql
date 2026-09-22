-- Agent-based discovery (docs/adr/0052-agent-based-discovery.md).

-- AlterEnum
ALTER TYPE "AssetDiscoverySource" ADD VALUE 'AGENT_NEIGHBOR';

-- AlterTable
ALTER TABLE "devices" ADD COLUMN "machine_fingerprint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenant_id_machine_fingerprint_key" ON "devices"("tenant_id", "machine_fingerprint");

-- CreateIndex
CREATE INDEX "assets_tenant_id_mac_address_idx" ON "assets"("tenant_id", "mac_address");
