-- TOTP opcional (Super Admin): activación y secreto cifrado.
ALTER TABLE "users" ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "totp_secret_encrypted" TEXT;
