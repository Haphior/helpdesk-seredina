-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('SERVER', 'WORKSTATION', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetDiscoverySource" AS ENUM ('MANUAL', 'AGENTLESS_SCAN');

-- CreateEnum
CREATE TYPE "DiscoveryJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "asset_type" "AssetType" NOT NULL DEFAULT 'OTHER',
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "ip_address" TEXT,
    "mac_address" TEXT,
    "hostname" TEXT,
    "serial_number" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "operating_system" TEXT,
    "discovery_source" "AssetDiscoverySource" NOT NULL DEFAULT 'MANUAL',
    "snmp_sys_descr" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_assets" (
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,

    CONSTRAINT "ticket_assets_pkey" PRIMARY KEY ("ticket_id","asset_id")
);

-- CreateTable
CREATE TABLE "discovery_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cidr_range" TEXT NOT NULL,
    "status" "DiscoveryJobStatus" NOT NULL DEFAULT 'PENDING',
    "discovered_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "discovery_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_tenant_id_ip_address_key" ON "assets"("tenant_id", "ip_address");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assets" ADD CONSTRAINT "ticket_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assets" ADD CONSTRAINT "ticket_assets_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assets" ADD CONSTRAINT "ticket_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_jobs" ADD CONSTRAINT "discovery_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
