-- Auditoría de accesos (login / fallos / cambio de clave / logout).
CREATE TYPE "AuthAuditAction" AS ENUM (
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'PASSWORD_CHANGE',
  'LOGOUT'
);

CREATE TABLE "auth_audit_logs" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "email_attempted" VARCHAR(100) NOT NULL,
  "action" "AuthAuditAction" NOT NULL,
  "ip_address" VARCHAR(64) NOT NULL,
  "user_agent" VARCHAR(512) NOT NULL,
  "city" VARCHAR(120) NOT NULL DEFAULT '',
  "country" VARCHAR(120) NOT NULL DEFAULT '',
  "is_suspicious" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_audit_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "auth_audit_logs"
  ADD CONSTRAINT "auth_audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "auth_audit_logs_user_id_created_at_idx" ON "auth_audit_logs" ("user_id", "created_at");
CREATE INDEX "auth_audit_logs_email_attempted_created_at_idx" ON "auth_audit_logs" ("email_attempted", "created_at");
