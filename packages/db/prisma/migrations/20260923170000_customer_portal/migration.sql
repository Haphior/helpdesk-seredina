-- Customer portal -- see docs/adr/0065-customer-portal.md.
ALTER TABLE "tenants" ADD COLUMN "customer_portal_enabled" BOOLEAN NOT NULL DEFAULT false;
