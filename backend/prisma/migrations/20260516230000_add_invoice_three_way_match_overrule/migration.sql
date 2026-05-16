-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN "three_way_match_overruled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "three_way_match_overruled_at" TIMESTAMP(3),
ADD COLUMN "three_way_match_overruled_by_id" UUID,
ADD COLUMN "three_way_match_overrule_notes" TEXT;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_three_way_match_overruled_by_id_fkey" FOREIGN KEY ("three_way_match_overruled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
