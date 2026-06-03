#!/usr/bin/env node
/**
 * Reporte completo de ESLint (mismo alcance que GitHub Actions CI).
 * Uso: node scripts/eslint-ci-report.mjs
 * Salida: eslint-ci-report.json + resumen en consola.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const outJson = path.join(backendRoot, 'eslint-ci-report.json');
const glob = '{src,apps,libs,test}/**/*.ts';

const run = spawnSync(
  'npx',
  ['eslint', glob, '--max-warnings', '0', '-f', 'json'],
  {
    cwd: backendRoot,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  },
);

let results = [];
if (run.stdout?.trim()) {
  try {
    results = JSON.parse(run.stdout);
  } catch {
    console.error('No se pudo parsear salida JSON de ESLint.');
    console.error(run.stdout?.slice(0, 2000));
    process.exit(1);
  }
}

const byRule = new Map();
const byFile = new Map();
let errors = 0;
let warnings = 0;

for (const file of results) {
  const rel = path.relative(backendRoot, file.filePath).replace(/\\/g, '/');
  if (!file.messages?.length) continue;
  let fe = 0;
  let fw = 0;
  for (const msg of file.messages) {
    if (msg.severity === 2) errors++;
    else warnings++;
    fe += msg.severity === 2 ? 1 : 0;
    fw += msg.severity === 1 ? 1 : 0;
    const rule = msg.ruleId ?? '(sin regla)';
    const r = byRule.get(rule) ?? { error: 0, warn: 0 };
    if (msg.severity === 2) r.error++;
    else r.warn++;
    byRule.set(rule, r);
  }
  byFile.set(rel, { error: fe, warn: fw, messages: file.messages });
}

fs.writeFileSync(outJson, JSON.stringify({ errors, warnings, byFile: Object.fromEntries(byFile) }, null, 2));

console.log('\n=== ESLint CI report (backend) ===');
console.log(`Comando: npx eslint "${glob}" --max-warnings 0`);
console.log(`Errores: ${errors}  |  Warnings: ${warnings}`);
console.log(`JSON: ${path.relative(process.cwd(), outJson)}\n`);

const topRules = [...byRule.entries()]
  .sort((a, b) => b[1].error + b[1].warn - (a[1].error + a[1].warn))
  .slice(0, 15);
console.log('Top reglas:');
for (const [rule, c] of topRules) {
  console.log(`  ${rule}  (${c.error}E / ${c.warn}W)`);
}

const topFiles = [...byFile.entries()]
  .sort((a, b) => b[1].error + b[1].warn - (a[1].error + a[1].warn))
  .slice(0, 20);
console.log('\nTop archivos:');
for (const [f, c] of topFiles) {
  console.log(`  ${c.error}E/${c.warn}W  ${f}`);
}

if (errors + warnings > 0 && topFiles.length) {
  const [first, data] = topFiles[0];
  console.log(`\nPrimer archivo con issues (${first}):`);
  for (const m of data.messages.slice(0, 12)) {
    console.log(
      `  L${m.line}:${m.column} ${m.severity === 2 ? 'error' : 'warn'}  ${m.message}  [${m.ruleId}]`,
    );
  }
}

process.exit(run.status ?? 1);
