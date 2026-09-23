-- Security audit log -- see docs/adr/0058-audit-log.md.
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "actor_label" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "target_label" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
CREATE INDEX "audit_logs_tenant_id_action_created_at_idx" ON "audit_logs"("tenant_id", "action", "created_at");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New permission, granted to every tenant's existing built-in admin role so
-- upgrading doesn't leave admins unable to see the log. (The seed step adds
-- the catalog row too; doing it here as well makes this migration
-- self-contained.) Runs as app_migrator, the table owner, so RLS doesn't apply.
INSERT INTO "permissions" ("id", "key") VALUES (gen_random_uuid(), 'audit:read')
  ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
SELECT r."tenant_id", r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."key" = 'admin' AND p."key" = 'audit:read'
ON CONFLICT DO NOTHING;
