-- When the current SLA clock started (creation or the latest priority change),
-- for the console's SLA countdown. Nullable: older tickets fall back to created_at.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "sla_started_at" TIMESTAMP(3);
