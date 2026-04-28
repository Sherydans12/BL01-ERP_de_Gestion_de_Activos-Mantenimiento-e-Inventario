-- Configuración global de seguridad (una fila) y desafíos de segundo factor por correo (SUPER_ADMIN).

CREATE TABLE "platform_security_settings" (
    "id" UUID NOT NULL,
    "super_admin_step_up_email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_security_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "login_step_up_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "client_ip" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_step_up_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_step_up_challenges_user_id_expires_at_idx" ON "login_step_up_challenges"("user_id", "expires_at");

CREATE INDEX "login_step_up_challenges_token_hash_idx" ON "login_step_up_challenges"("token_hash");

ALTER TABLE "login_step_up_challenges" ADD CONSTRAINT "login_step_up_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "platform_security_settings" ("id", "super_admin_step_up_email_enabled", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', false, CURRENT_TIMESTAMP);
