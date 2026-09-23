-- Contracts, warranties and licenses linked to assets -- see docs/adr/0062-contracts.md.
-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('SUPPORT', 'WARRANTY', 'LICENSE', 'LEASE', 'SUBSCRIPTION', 'OTHER');

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'CONTRACT_EXPIRING';


-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ContractType" NOT NULL DEFAULT 'SUPPORT',
    "supplier" TEXT,
    "reference" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "renewal_notice_days" INTEGER NOT NULL DEFAULT 30,
    "renewal_notified_at" TIMESTAMP(3),
    "cost" DECIMAL(14,2),
    "currency" TEXT,
    "billing_period" TEXT,
    "seats" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_assets" (
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_assets_pkey" PRIMARY KEY ("contract_id","asset_id")
);

-- CreateIndex
CREATE INDEX "contracts_tenant_id_end_date_idx" ON "contracts"("tenant_id", "end_date");

-- CreateIndex
CREATE INDEX "contract_assets_asset_id_idx" ON "contract_assets"("asset_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

