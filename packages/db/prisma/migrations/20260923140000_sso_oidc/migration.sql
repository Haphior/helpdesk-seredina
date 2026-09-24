-- Single sign-on over OpenID Connect -- see docs/adr/0062-sso-oidc.md.
CREATE TABLE "tenant_sso_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_encrypted" TEXT NOT NULL,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auto_provision" BOOLEAN NOT NULL DEFAULT false,
    "default_role_key" TEXT NOT NULL DEFAULT 'agent',
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_sso_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_sso_settings_tenant_id_key" ON "tenant_sso_settings"("tenant_id");

ALTER TABLE "tenant_sso_settings" ADD CONSTRAINT "tenant_sso_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
