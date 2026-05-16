-- =============================================================================
-- Migration: approval_policy_users_replace_role
-- Descripción: Reemplaza el enfoque de firma por TenantRole en ApprovalPolicy
--              por una tabla intermedia de usuarios autorizados por nivel.
--
-- Orden de operaciones:
--   1. Crear tabla approval_policy_users (vacía, con FK + índices)
--   2. [DATA MIGRATION] Poblar approval_policy_users desde políticas existentes
--      buscando usuarios que tengan el customRoleId o el rol base espejo
--   3. DROP FK constraint + columna role_id de approval_policies
--
-- IMPORTANTE: El paso 2 es best-effort. Si no hay usuarios asignados al rol
-- de una política, esa política queda sin usuarios autorizados y debe
-- reconfigurarse manualmente desde el panel de Config. Compras.
-- =============================================================================


-- ============================================================
-- PASO 1: Crear tabla approval_policy_users
-- ============================================================

CREATE TABLE "approval_policy_users" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "policy_id"  UUID NOT NULL,
    "user_id"    UUID NOT NULL,
    "tenant_id"  UUID NOT NULL,

    CONSTRAINT "approval_policy_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_policy_users_policy_id_fkey"
        FOREIGN KEY ("policy_id") REFERENCES "approval_policies"("id") ON DELETE CASCADE,
    CONSTRAINT "approval_policy_users_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "approval_policy_users_policy_id_user_id_key"
        UNIQUE ("policy_id", "user_id")
);

CREATE INDEX "approval_policy_users_tenant_id_user_id_idx"
    ON "approval_policy_users"("tenant_id", "user_id");


-- ============================================================
-- PASO 2: Migración de datos — usuarios por rol existente
--
-- Para cada política existente, insertamos en approval_policy_users
-- todos los usuarios del mismo tenant que cumplan UNA de estas condiciones:
--   (a) user.custom_role_id = policy.role_id  (rol custom asignado explícitamente)
--   (b) user.custom_role_id IS NULL
--       AND user.role = tenant_roles.base_role  (coincide con el rol espejo)
--       AND tenant_roles.name = 'Sistema · ' || base_role_display
--       (equivalente a la lógica de SYSTEM_MIRROR_ROLE_NAME en el backend)
--
-- Nota: Los roles espejo tienen nombre 'Sistema · ADMIN', 'Sistema · SUPERVISOR', etc.
-- El join usa ese patrón para identificarlos sin hard-codear UUIDs.
-- ============================================================

INSERT INTO "approval_policy_users" ("id", "policy_id", "user_id", "tenant_id")
SELECT
    gen_random_uuid(),
    ap.id        AS policy_id,
    u.id         AS user_id,
    ap.tenant_id AS tenant_id
FROM "approval_policies" ap
JOIN "tenant_roles" tr ON tr.id = ap.role_id
JOIN "users" u ON (
    u.tenant_id = ap.tenant_id
    AND u.is_active = true
    AND (
        -- (a) Usuario tiene asignado explícitamente ese rol custom
        u.custom_role_id = ap.role_id
        OR
        -- (b) Usuario sin rol custom cuyo role base coincide con el rol espejo de la política
        (
            u.custom_role_id IS NULL
            AND u.role::text = tr.base_role::text
            AND tr.name = 'Sistema · ' || (
                CASE tr.base_role::text
                    WHEN 'ADMIN'      THEN 'ADMIN'
                    WHEN 'SUPERVISOR' THEN 'SUPERVISOR'
                    WHEN 'MECHANIC'   THEN 'MECHANIC'
                    ELSE tr.base_role::text
                END
            )
        )
    )
)
ON CONFLICT ("policy_id", "user_id") DO NOTHING;


-- ============================================================
-- PASO 3: Eliminar columna role_id de approval_policies
--
-- Se elimina primero el FK constraint (Postgres nombra automáticamente
-- el constraint como approval_policies_role_id_fkey).
-- ============================================================

ALTER TABLE "approval_policies"
    DROP CONSTRAINT IF EXISTS "approval_policies_role_id_fkey";

ALTER TABLE "approval_policies"
    DROP COLUMN IF EXISTS "role_id";
