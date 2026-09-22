-- Covers the default ticket-queue sort (tenantId filter + ORDER BY createdAt
-- DESC), which previously had no index for the sort step -- see the schema
-- comment on Ticket.@@index([tenantId, createdAt]) and the performance
-- report that found this via EXPLAIN ANALYZE.
CREATE INDEX "tickets_tenant_id_created_at_idx" ON "tickets"("tenant_id", "created_at");
