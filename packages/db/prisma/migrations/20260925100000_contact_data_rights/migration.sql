-- Contact data rights: export, anonymization and automatic retention --
-- see docs/adr/0066-contact-data-rights.md.
ALTER TABLE "contacts" ADD COLUMN "anonymized_at" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "contact_retention_days" INTEGER;

-- New permission, granted to every tenant's built-in admin role so upgrading
-- doesn't leave admins without it (the seed step adds the catalog row too).
INSERT INTO "permissions" ("id", "key") VALUES (gen_random_uuid(), 'contacts:manage')
  ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
SELECT r."tenant_id", r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."key" = 'admin' AND p."key" = 'contacts:manage'
ON CONFLICT DO NOTHING;
