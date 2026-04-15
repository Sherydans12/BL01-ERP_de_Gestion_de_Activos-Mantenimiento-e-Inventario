import { ForbiddenException } from '@nestjs/common';

/**
 * Verifica acceso a un contrato de compras según JWT / usuario cargado.
 * ADMIN y SUPER_ADMIN tienen alcance global en el tenant.
 * `allowedContracts` puede incluir 'ALL' (payload de login) o IDs de UserContract.
 */
export function assertUserHasContractAccess(
  user: {
    role?: string;
    allowedContracts?: string[];
  },
  contractId: string,
  message = 'No tiene acceso al contrato de esta operación',
): void {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    return;
  }
  const allowed = user.allowedContracts ?? [];
  if (allowed.includes('ALL')) {
    return;
  }
  if (allowed.includes(contractId)) {
    return;
  }
  throw new ForbiddenException(message);
}
