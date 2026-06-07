/**
 * Seed avanzado local — orden fijo e idempotente en cada fase.
 *
 * Uso:
 *   cd backend && npm run seed:advanced
 *
 * Variables (.env):
 *   TENANT_CODE=TPM
 *   KEEP_ADMIN_EMAIL=admin@tpm.cl
 *   BOOTSTRAP_USER_PASSWORD=Test1234!
 *   PBAC_TEST_PASSWORD=Test1234!
 *   SKIP_CLEAN=1          — omite fases 0–1 (solo maestros + PBAC)
 *   SKIP_PBAC=1           — omite personas PBAC (fase 3)
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const backendRoot = resolve(__dirname, '..');

type Phase = { title: string; npmScript: string };

const PHASES: Phase[] = [
  {
    title: '0 · Ítems de carga LOAD- (si existen)',
    npmScript: 'db:clean-demo-artifacts',
  },
  {
    title: '1 · Reset operativo + usuarios negocio TPM',
    npmScript: 'db:clean-bootstrap-tpm',
  },
  {
    title: '2 · Maestros inventario (UoM + bodegas por contrato)',
    npmScript: 'seed:inventory-masters',
  },
  {
    title: '3a · Personas PBAC Compras (+ matriz ACL)',
    npmScript: 'seed:compras-pbac-personas',
  },
  {
    title: '3b · Personas PBAC Inventario',
    npmScript: 'seed:inventario-pbac-personas',
  },
  {
    title: '3c · Personas PBAC Operaciones (+ equipo/bodega E2E)',
    npmScript: 'seed:operaciones-pbac-personas',
  },
];

function runPhase(phase: Phase): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${phase.title}`);
  console.log(`  npm run ${phase.npmScript}`);
  console.log(`${'─'.repeat(60)}\n`);
  execSync(`npm run ${phase.npmScript}`, {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
  });
}

function printSummary(): void {
  const pwd =
    process.env.BOOTSTRAP_USER_PASSWORD ||
    process.env.PBAC_TEST_PASSWORD ||
    'Test1234!';
  console.log(`
${'═'.repeat(60)}
  ✅ Seed avanzado completado
${'═'.repeat(60)}

  Admin TPM (conservado): ${process.env.KEEP_ADMIN_EMAIL || 'admin@tpm.cl'}
  Usuarios negocio TPM:   ver salida fase 1 (db:clean-bootstrap-tpm)
  PBAC Compras/Inventario/Operaciones: *@test.com / pbac-*
  Contraseña PBAC y bootstrap: ${pwd}

  Tras cambiar usuarios PBAC: cerrar sesión y volver a entrar (JWT).

  Simulaciones API opcionales (backend en :3000):
    npm run simulate:compras-pbac
    npm run simulate:inventario-pbac
`);
}

function main(): void {
  const skipClean = process.env.SKIP_CLEAN === '1';
  const skipPbac = process.env.SKIP_PBAC === '1';

  console.log(`
${'═'.repeat(60)}
  TPM — Seed avanzado (demo local ordenado)
  TENANT_CODE=${process.env.TENANT_CODE || 'TPM'}
${'═'.repeat(60)}
`);

  for (const phase of PHASES) {
    if (skipClean && (phase.npmScript.startsWith('db:clean') || phase.npmScript === 'db:clean-bootstrap-tpm')) {
      console.log(`⏭  Omitido: ${phase.title}`);
      continue;
    }
    if (skipPbac && phase.npmScript.includes('pbac')) {
      console.log(`⏭  Omitido: ${phase.title}`);
      continue;
    }
    runPhase(phase);
  }

  printSummary();
}

main();
