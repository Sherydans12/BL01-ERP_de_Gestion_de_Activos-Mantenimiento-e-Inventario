-- Work order form refactor: optional final meter, personnel count, mechanic datetimes, remove OM + legacy mechanic time fields

ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "maintenance_order_number";

ALTER TABLE "work_orders" ALTER COLUMN "final_meter" DROP NOT NULL;

ALTER TABLE "work_orders" ADD COLUMN "personnel_quantity" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "work_orders" ADD COLUMN "mechanic_attention_started_at" TIMESTAMP(3);
ALTER TABLE "work_orders" ADD COLUMN "mechanic_attention_ended_at" TIMESTAMP(3);

ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "mechanic_attention_date";
ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "mechanic_attention_from_time";
ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "mechanic_attention_to_time";
