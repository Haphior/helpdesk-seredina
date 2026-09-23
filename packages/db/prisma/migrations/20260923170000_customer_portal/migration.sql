-- Customer portal -- see docs/adr/0063-customer-portal.md.
ALTER TABLE "tenants" ADD COLUMN "customer_portal_enabled" BOOLEAN NOT NULL DEFAULT false;
