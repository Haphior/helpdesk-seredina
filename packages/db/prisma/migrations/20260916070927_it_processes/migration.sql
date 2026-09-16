-- CreateEnum
CREATE TYPE "ProcessInstanceStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcessStepStatus" AS ENUM ('PENDING', 'DONE', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateTable
CREATE TABLE "process_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_step_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "process_template_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "team_id" UUID,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "process_step_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_instances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "process_template_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "ProcessInstanceStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "process_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_step_instances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "process_instance_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProcessStepStatus" NOT NULL DEFAULT 'PENDING',
    "assignee_id" UUID,
    "completed_at" TIMESTAMP(3),
    "ticket_id" UUID,

    CONSTRAINT "process_step_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "process_templates_tenant_id_name_key" ON "process_templates"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_step_templates" ADD CONSTRAINT "process_step_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_step_templates" ADD CONSTRAINT "process_step_templates_process_template_id_fkey" FOREIGN KEY ("process_template_id") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_step_templates" ADD CONSTRAINT "process_step_templates_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_instances" ADD CONSTRAINT "process_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_instances" ADD CONSTRAINT "process_instances_process_template_id_fkey" FOREIGN KEY ("process_template_id") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_step_instances" ADD CONSTRAINT "process_step_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_step_instances" ADD CONSTRAINT "process_step_instances_process_instance_id_fkey" FOREIGN KEY ("process_instance_id") REFERENCES "process_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_step_instances" ADD CONSTRAINT "process_step_instances_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_step_instances" ADD CONSTRAINT "process_step_instances_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
