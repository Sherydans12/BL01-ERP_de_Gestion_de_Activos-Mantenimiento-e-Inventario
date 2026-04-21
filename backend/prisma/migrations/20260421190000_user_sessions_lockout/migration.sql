-- Bloqueo temporal por fuerza bruta.
ALTER TABLE "users" ADD COLUMN "lockout_until" TIMESTAMP(3);

-- Sesiones JWT (jti) revocables.
CREATE TABLE "user_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "jti" VARCHAR(64) NOT NULL,
  "device_label" VARCHAR(200) NOT NULL,
  "ip_address" VARCHAR(64) NOT NULL,
  "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_valid" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_sessions_jti_key" ON "user_sessions" ("jti");

CREATE INDEX "user_sessions_user_id_is_valid_idx" ON "user_sessions" ("user_id", "is_valid");

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
