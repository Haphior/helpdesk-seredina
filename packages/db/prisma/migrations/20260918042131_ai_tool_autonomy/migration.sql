-- CreateEnum
CREATE TYPE "AiAgentRunStatus" AS ENUM ('PENDING_APPROVAL', 'EXECUTED', 'REJECTED', 'FAILED');

-- Deliberately NOT including a DROP INDEX on kb_chunks_embedding_idx here, even
-- though `prisma migrate diff` proposes one: that HNSW index was hand-appended
-- to the kb_chunk_rag migration (Prisma's schema DSL has no vector operator
-- class concept, see docs/adr/0032-rag-knowledge-base-search.md) and is
-- invisible to Prisma's own diff engine, which otherwise "corrects" for it by
-- dropping it. This is also, in all likelihood, exactly what made
-- `prisma migrate dev` refuse to run non-interactively -- it wanted
-- confirmation before dropping an index it doesn't know is intentional.

-- CreateTable
CREATE TABLE "autonomy_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "auto_execute_tools" TEXT[],
    "max_actions_per_day" INTEGER NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autonomy_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID,
    "tool_name" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" JSONB,
    "status" "AiAgentRunStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "source" TEXT NOT NULL,
    "error_message" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_policies_tenant_id_key" ON "autonomy_policies"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_agent_runs_tenant_id_status_idx" ON "ai_agent_runs"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "autonomy_policies" ADD CONSTRAINT "autonomy_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
