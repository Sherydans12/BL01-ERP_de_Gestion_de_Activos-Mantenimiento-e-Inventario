-- Fase 2: Permiso dinámico por usuario para autorizar discrepancias de 3-way match.
-- Añade columna can_overrule_three_way_match a la tabla users (default false, no breaking).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "can_overrule_three_way_match" BOOLEAN NOT NULL DEFAULT false;
