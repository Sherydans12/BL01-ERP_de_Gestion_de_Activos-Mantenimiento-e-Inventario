/**
 * Cursor hook: sessionStart
 * Inyecta extractos de docs/agentes en el contexto inicial (estilo claude-mem, lectura desde git + log local).
 */
import fs from 'fs';
import path from 'path';

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function tailText(absPath, maxChars) {
  if (!fs.existsSync(absPath)) return '';
  const buf = fs.readFileSync(absPath, 'utf8');
  if (buf.length <= maxChars) return buf;
  return buf.slice(-maxChars);
}

const raw = readStdinSync().trim();
let input = {};
try {
  input = raw ? JSON.parse(raw) : {};
} catch {
  input = {};
}

const root = process.cwd();
const decisiones = tailText(path.join(root, 'docs/agentes/decisiones.md'), 9000);
const glosario = tailText(path.join(root, 'docs/agentes/glosario.md'), 4000);
const sesiones = tailText(path.join(root, 'docs/agentes/sesiones-auto.log.md'), 14000);

const additional_context = `## [BL01 — memoria automática al iniciar chat]

**Sesión:** \`${input.session_id ?? 'unknown'}\` · **modo:** ${input.composer_mode ?? '?'} · **background:** ${String(input.is_background_agent ?? false)}

1. Respetá \`.cursor/rules/tpm-arquitectura.mdc\` y \`AGENTS.md\`.
2. Extracto de \`docs/agentes/decisiones.md\` (puede estar vacío):

---
${decisiones || '(sin archivo o vacío)'}
---

3. Extracto de \`docs/agentes/glosario.md\`:

---
${glosario || '(sin archivo o vacío)'}
---

4. Registro local reciente (\`sesiones-auto.log.md\`, generado por hooks; no versionado):

---
${sesiones || '(aún sin entradas)'}
---

5. Si el usuario pide **guardar sesión** / **resumí para memoria**: proponé apéndice breve a \`decisiones.md\`. Guía: \`docs/agentes/flujo-memoria-cursor.md\`.
`;

process.stdout.write(JSON.stringify({ additional_context }));
