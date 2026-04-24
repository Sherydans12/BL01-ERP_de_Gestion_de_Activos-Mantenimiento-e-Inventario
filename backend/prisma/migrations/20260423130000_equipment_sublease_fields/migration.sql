-- Subarriendo: empresa arrendataria y flag explícito
ALTER TABLE "equipments"
ADD COLUMN "is_subleased" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "equipments"
ADD COLUMN "sublease_company_name" VARCHAR(200);
