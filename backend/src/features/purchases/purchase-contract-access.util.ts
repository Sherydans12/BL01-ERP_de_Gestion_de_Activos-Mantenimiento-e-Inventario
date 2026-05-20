import { ForbiddenException } from '@nestjs/common';
import {
  buildPurchaseContractScopeFilter,
  isTenantWideContractAccess,
  normalizedAllowedContractIds,
  type ContractScopedUser,
} from '../../common/contract-scope.util';

export {
  buildPurchaseContractScopeFilter,
  isTenantWideContractAccess,
  normalizedAllowedContractIds,
  type ContractScopedUser,
};

/**
 * Verifica acceso a un contrato según JWT / usuario cargado.
 * No depende del enum UserRole salvo bypass ADMIN / SUPER_ADMIN.
 */
export function assertUserHasContractAccess(
  user: ContractScopedUser,
  contractId: string,
  message = 'No tiene acceso al contrato de esta operación',
): void {
  if (isTenantWideContractAccess(user)) {
    return;
  }
  const allowed = normalizedAllowedContractIds(user);
  if (allowed.includes(contractId)) {
    return;
  }
  throw new ForbiddenException(message);
}
