/**
 * Cursor hook: sessionEnd (fire-and-forget; respuesta no usada por Cursor, pero dejamos JSON válido)
 * Registra cierre de sesión en docs/agentes/sesiones-auto.log.md (local, gitignored).
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

const raw = readStdinSync().trim();
let input = {};
try {
  input = raw ? JSON.parse(raw) : {};
} catch {
  input = {};
}

const root = process.cwd();
const logPath = path.join(root, 'docs', 'agentes', 'sesiones-auto.log.md');
fs.mkdirSync(path.dirname(logPath), { recursive: true });

const line =
  JSON.stringify({
    ts: new Date().toISOString(),
    kind: 'sessionEnd',
    session_id: input.session_id,
    reason: input.reason,
    duration_ms: input.duration_ms,
    is_background_agent: input.is_background_agent,
    final_status: input.final_status,
    error_message: input.error_message,
  }) + '\n';

fs.appendFileSync(logPath, line, 'utf8');
process.stdout.write('{}\n');
