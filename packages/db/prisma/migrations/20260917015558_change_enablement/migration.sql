-- CreateEnum
CREATE TYPE "ProcessTemplateKind" AS ENUM ('GENERAL', 'CHANGE');

-- CreateEnum
CREATE TYPE "ChangeRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "process_instances" ADD COLUMN     "planned_end" TIMESTAMP(3),
ADD COLUMN     "planned_start" TIMESTAMP(3),
ADD COLUMN     "risk_level" "ChangeRiskLevel",
ADD COLUMN     "rollback_plan" TEXT;

-- AlterTable
ALTER TABLE "process_templates" ADD COLUMN     "kind" "ProcessTemplateKind" NOT NULL DEFAULT 'GENERAL';
