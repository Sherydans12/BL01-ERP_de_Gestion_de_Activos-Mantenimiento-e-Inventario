/**
 * Alcance por contrato (JWT `allowedContracts` + rol base).
 * ADMIN / SUPER_ADMIN o `ALL` → tenant completo.
 * Resto → solo IDs en UserContract (independiente del enum UserRole).
 */

export const NO_CONTRACT_ACCESS_SENTINEL =
  '00000000-0000-4000-8000-000000000000';

export type ContractScopedUser = {
  role?: string;
  allowedContracts?: string[];
};

export function isTenantWideContractAccess(user: ContractScopedUser): boolean {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    return true;
  }
  return (user.allowedContracts ?? []).includes('ALL');
}

/** IDs de contrato asignados al usuario (sin sentinel ALL). */
export function normalizedAllowedContractIds(
  user: ContractScopedUser,
): string[] {
  return (user.allowedContracts ?? []).filter(
    (id) => typeof id === 'string' && id.length > 0 && id !== 'ALL',
  );
}

/**
 * Filtro Prisma `contractId` para compras (SRC, OC, recepciones, etc.).
 * Sin contratos asignados → sentinel que no coincide con filas reales.
 */
export function buildPurchaseContractScopeFilter(
  user?: ContractScopedUser,
  explicitContractId?: string,
): { contractId?: string | { in: string[] } } {
  const cid = explicitContractId?.trim();
  if (cid && cid !== 'ALL') {
    return { contractId: cid };
  }
  if (!user) {
    return {};
  }
  if (isTenantWideContractAccess(user)) {
    return {};
  }
  const allowed = normalizedAllowedContractIds(user);
  if (!allowed.length) {
    return { contractId: NO_CONTRACT_ACCESS_SENTINEL };
  }
  return { contractId: { in: allowed } };
}

/** OR de equipo/subcontrato para flota y OT (mismo alcance que compras). */
export function buildEquipmentContractAccessOr(
  user: ContractScopedUser,
  activeContract?: string,
): Array<Record<string, unknown>> {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    if (activeContract && activeContract !== 'ALL') {
      return [
        { contractId: activeContract },
        { subcontract: { contractId: activeContract } },
      ];
    }
    return [];
  }

  const allowed = normalizedAllowedContractIds(user);
  if (!allowed.length) {
    return [
      { contractId: NO_CONTRACT_ACCESS_SENTINEL },
      { subcontract: { contractId: NO_CONTRACT_ACCESS_SENTINEL } },
    ];
  }
  return [
    { contractId: { in: allowed } },
    { subcontract: { contractId: { in: allowed } } },
  ];
}
