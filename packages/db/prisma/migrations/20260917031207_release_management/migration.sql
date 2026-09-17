-- AlterEnum
ALTER TYPE "ProcessTemplateKind" ADD VALUE 'RELEASE';

-- AlterTable
ALTER TABLE "process_instances" ADD COLUMN     "change_instance_id" UUID,
ADD COLUMN     "release_version" TEXT;

-- AddForeignKey
ALTER TABLE "process_instances" ADD CONSTRAINT "process_instances_change_instance_id_fkey" FOREIGN KEY ("change_instance_id") REFERENCES "process_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
