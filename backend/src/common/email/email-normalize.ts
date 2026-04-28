/**
 * Trim + minúsculas para login, anti-duplicados y almacenamiento consistente.
 * La parte local del correo puede ser case-sensitive en RFC5321; en este producto se trata como insensible (uso típico empresarial).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Condición Prisma (PostgreSQL) para coincidir emails con distinto casing en filas legadas. */
export function prismaEmailInsensitive(email: string) {
  return {
    equals: normalizeEmail(email),
    mode: 'insensitive' as const,
  };
}
