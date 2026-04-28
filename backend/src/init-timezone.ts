/**
 * Zona horaria por defecto para logs (Nest Logger usa Intl → respeta process.env.TZ).
 * Contenedores suelen ir en UTC; sin TZ las marcas salen en UTC.
 * Puede anularse con TZ=... en el entorno (Coolify/Docker/systemd).
 */
if (!process.env.TZ) {
  process.env.TZ = 'America/Santiago';
}
