-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('UNDER_INVESTIGATION', 'KNOWN_ERROR', 'RESOLVED', 'CLOSED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "last_problem_number" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "problem_id" UUID;

-- CreateTable
CREATE TABLE "problems" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProblemStatus" NOT NULL DEFAULT 'UNDER_INVESTIGATION',
    "root_cause" TEXT,
    "workaround" TEXT,
    "change_instance_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "problems_tenant_id_number_key" ON "problems"("tenant_id", "number");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_change_instance_id_fkey" FOREIGN KEY ("change_instance_id") REFERENCES "process_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
