-- Fecha de creación de la reserva (trazabilidad "quién retiene").
ALTER TABLE "stock_reservations" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
