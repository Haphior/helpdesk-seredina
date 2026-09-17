-- CreateEnum
CREATE TYPE "EscalationRunStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'EXHAUSTED');

-- CreateTable
CREATE TABLE "on_call_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "on_call_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "on_call_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_tiers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "user_id" UUID,
    "on_call_schedule_id" UUID,
    "escalate_after_minutes" INTEGER NOT NULL,

    CONSTRAINT "escalation_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "current_tier_index" INTEGER NOT NULL DEFAULT 0,
    "status" "EscalationRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "on_call_schedules_tenant_id_name_key" ON "on_call_schedules"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "on_call_schedules" ADD CONSTRAINT "on_call_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_shifts" ADD CONSTRAINT "on_call_shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_shifts" ADD CONSTRAINT "on_call_shifts_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "on_call_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_shifts" ADD CONSTRAINT "on_call_shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_tiers" ADD CONSTRAINT "escalation_tiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_tiers" ADD CONSTRAINT "escalation_tiers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_tiers" ADD CONSTRAINT "escalation_tiers_on_call_schedule_id_fkey" FOREIGN KEY ("on_call_schedule_id") REFERENCES "on_call_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_runs" ADD CONSTRAINT "escalation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_runs" ADD CONSTRAINT "escalation_runs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_runs" ADD CONSTRAINT "escalation_runs_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
