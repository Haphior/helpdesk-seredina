/*
  Warnings:

  - Added the required column `template_name` to the `process_instances` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "process_instances" DROP CONSTRAINT "process_instances_process_template_id_fkey";

-- AlterTable
ALTER TABLE "process_instances" ADD COLUMN     "template_name" TEXT NOT NULL,
ALTER COLUMN "process_template_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "process_instances" ADD CONSTRAINT "process_instances_process_template_id_fkey" FOREIGN KEY ("process_template_id") REFERENCES "process_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
