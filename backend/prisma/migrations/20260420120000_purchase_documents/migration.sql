-- CreateEnum
CREATE TYPE "PurchaseDocumentEntity" AS ENUM ('REQUISITION', 'PURCHASE_ORDER', 'PURCHASE_INVOICE');

-- CreateTable
CREATE TABLE "purchase_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity" "PurchaseDocumentEntity" NOT NULL,
    "entity_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_documents_tenant_id_entity_entity_id_idx" ON "purchase_documents"("tenant_id", "entity", "entity_id");

-- AddForeignKey
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
