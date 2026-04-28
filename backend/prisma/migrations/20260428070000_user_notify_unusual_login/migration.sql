-- Preferencia por usuario: alerta por correo ante IP/país distintos al último login.
ALTER TABLE "users" ADD COLUMN "notify_unusual_login" BOOLEAN NOT NULL DEFAULT true;
