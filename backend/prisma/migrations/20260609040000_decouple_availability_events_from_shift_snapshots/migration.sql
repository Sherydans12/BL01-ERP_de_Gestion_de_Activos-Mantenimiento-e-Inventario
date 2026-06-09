-- DropForeignKey
ALTER TABLE "availability_events" DROP CONSTRAINT "availability_events_availability_id_fkey";

-- AlterTable
ALTER TABLE "availability_events" ALTER COLUMN "availability_id" DROP NOT NULL;
ALTER TABLE "availability_events" ADD COLUMN "fault_report_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "availability_events_fault_report_id_key" ON "availability_events"("fault_report_id");

-- AddForeignKey
ALTER TABLE "availability_events" ADD CONSTRAINT "availability_events_availability_id_fkey" FOREIGN KEY ("availability_id") REFERENCES "equipment_availabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_events" ADD CONSTRAINT "availability_events_fault_report_id_fkey" FOREIGN KEY ("fault_report_id") REFERENCES "fault_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
