-- CreateTable
CREATE TABLE "tenant_kb_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "portal_enabled" BOOLEAN NOT NULL DEFAULT true,
    "hashed_access_code" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_kb_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_kb_settings_tenant_id_key" ON "tenant_kb_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_kb_settings" ADD CONSTRAINT "tenant_kb_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
