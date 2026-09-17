-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "merged_into_id" UUID;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
