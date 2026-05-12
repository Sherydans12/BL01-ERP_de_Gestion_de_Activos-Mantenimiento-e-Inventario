-- Per-user opt-in for email OTP step-up (complementa política global).
ALTER TABLE "users" ADD COLUMN "email_2fa_enabled" BOOLEAN NOT NULL DEFAULT false;
