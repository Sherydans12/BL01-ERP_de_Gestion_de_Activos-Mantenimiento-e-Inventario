-- V1.0 flujo de transferencia en dos pasos:
-- create/send -> SHIPPED, receive -> COMPLETED
ALTER TYPE "InventoryTransferStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';

ALTER TABLE "inventory_transfers"
ALTER COLUMN "status" SET DEFAULT 'SHIPPED';
