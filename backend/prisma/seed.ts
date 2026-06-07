/**
 * Prisma seed intencionalmente vacío: el despliegue previsto restaura un dump
 * de la base local (pg_dump / restore). No insertar datos de negocio aquí.
 *
 * Catálogos maestros (diccionarios): npm run seed:catalog-masters
 * Limpieza + usuarios TPM: npm run db:clean-bootstrap-tpm
 * Demo local completo (limpieza + maestros + PBAC): npm run seed:advanced
 */
try {
  console.log(
    'prisma seed: sin cambios de datos. Restaurar desde dump o usar seed:catalog-masters / db:clean-bootstrap-tpm.',
  );
} catch (e) {
  console.error(e);
  process.exit(1);
}
