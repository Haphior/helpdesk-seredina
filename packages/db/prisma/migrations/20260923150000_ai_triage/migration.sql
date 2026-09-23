-- AI triage of new tickets -- see docs/adr/0061-ai-triage.md.
ALTER TABLE "tickets" ADD COLUMN "ai_triage" JSONB;
ALTER TABLE "tenants" ADD COLUMN "ai_triage_mode" TEXT NOT NULL DEFAULT 'off';
