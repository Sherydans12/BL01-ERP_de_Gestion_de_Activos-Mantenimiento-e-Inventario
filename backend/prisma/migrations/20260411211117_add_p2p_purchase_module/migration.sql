-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'QUOTING', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('RECEIVED', 'SELECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PARTIALLY_APPROVED', 'APPROVED', 'SENT_TO_SUPPLIER', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SignatureIntegrity" AS ENUM ('VALID', 'COMPROMISED');

-- CreateTable
CREATE TABLE "sequence_counters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_type" VARCHAR(10) NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "rut" VARCHAR(20),
    "contact_name" VARCHAR(100),
    "contact_email" VARCHAR(100),
    "contact_phone" VARCHAR(20),
    "address" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "approval_threshold" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'CLP',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policies" (
    "id" UUID NOT NULL,
    "purchase_settings_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "description" VARCHAR(100),
    "role_id" UUID NOT NULL,
    "min_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "correlative" VARCHAR(30) NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL,
    "justification" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisition_items" (
    "id" UUID NOT NULL,
    "requisition_id" UUID NOT NULL,
    "inventory_item_id" UUID,
    "description" VARCHAR(255) NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" VARCHAR(20) NOT NULL,
    "estimated_cost" DECIMAL(18,2),

    CONSTRAINT "requisition_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_quotations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requisition_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'CLP',
    "delivery_days" INTEGER,
    "valid_until" TIMESTAMP(3),
    "attachment_url" VARCHAR(500),
    "status" "QuotationStatus" NOT NULL DEFAULT 'RECEIVED',
    "is_winner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "requisition_item_id" UUID NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "brand" VARCHAR(100),
    "notes" VARCHAR(255),

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "quotation_id" UUID,
    "correlative" VARCHAR(30) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'CLP',
    "required_signatures" INTEGER NOT NULL DEFAULT 2,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "inventory_item_id" UUID,
    "description" VARCHAR(255) NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_approvals" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "comment" TEXT,
    "signature_hash" VARCHAR(64) NOT NULL,
    "integrity_status" "SignatureIntegrity" NOT NULL DEFAULT 'VALID',
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "received_by_id" UUID NOT NULL,
    "correlative" VARCHAR(30) NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "observations" TEXT,
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_items" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity_expected" DOUBLE PRECISION NOT NULL,
    "quantity_received" DOUBLE PRECISION NOT NULL,
    "observations" TEXT,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sequence_counters_tenant_id_document_type_key" ON "sequence_counters"("tenant_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenant_id_code_key" ON "vendors"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenant_id_rut_key" ON "vendors"("tenant_id", "rut");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_settings_tenant_id_key" ON "purchase_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_policies_tenant_id_level_key" ON "approval_policies"("tenant_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_tenant_id_correlative_key" ON "purchase_requisitions"("tenant_id", "correlative");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_quotation_id_key" ON "purchase_orders"("quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_correlative_key" ON "purchase_orders"("tenant_id", "correlative");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_approvals_purchase_order_id_level_key" ON "purchase_order_approvals"("purchase_order_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_receipts_tenant_id_correlative_key" ON "warehouse_receipts"("tenant_id", "correlative");

-- AddForeignKey
ALTER TABLE "sequence_counters" ADD CONSTRAINT "sequence_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settings" ADD CONSTRAINT "purchase_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_purchase_settings_id_fkey" FOREIGN KEY ("purchase_settings_id") REFERENCES "purchase_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "tenant_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_items" ADD CONSTRAINT "requisition_items_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_items" ADD CONSTRAINT "requisition_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quotations" ADD CONSTRAINT "purchase_quotations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quotations" ADD CONSTRAINT "purchase_quotations_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quotations" ADD CONSTRAINT "purchase_quotations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "purchase_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_requisition_item_id_fkey" FOREIGN KEY ("requisition_item_id") REFERENCES "requisition_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "purchase_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_receipts" ADD CONSTRAINT "warehouse_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_receipts" ADD CONSTRAINT "warehouse_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_receipts" ADD CONSTRAINT "warehouse_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_receipts" ADD CONSTRAINT "warehouse_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "warehouse_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
