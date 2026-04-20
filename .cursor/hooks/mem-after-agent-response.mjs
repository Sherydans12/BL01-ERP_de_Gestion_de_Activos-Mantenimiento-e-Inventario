/**
 * Cursor hook: afterAgentResponse
 * Append-only local log (preview del mensaje del asistente). Rotación por tamaño.
 */
import fs from 'fs';
import path from 'path';

const MAX_FILE_BYTES = 200_000;

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

const text = typeof input.text === 'string' ? input.text : '';
const preview = text
  .replace(/\s+/g, ' ')
  .slice(0, 500)
  .trim();

const root = process.cwd();
const logPath = path.join(root, 'docs', 'agentes', 'sesiones-auto.log.md');
fs.mkdirSync(path.dirname(logPath), { recursive: true });

const line =
  JSON.stringify({
    ts: new Date().toISOString(),
    kind: 'afterAgentResponse',
    chars: text.length,
    preview: preview || '(vacío)',
  }) + '\n';

fs.appendFileSync(logPath, line, 'utf8');

try {
  const st = fs.statSync(logPath);
  if (st.size > MAX_FILE_BYTES) {
    const keep = fs.readFileSync(logPath, 'utf8').slice(-Math.floor(MAX_FILE_BYTES * 0.85));
    const header =
      '<!-- rotado automáticamente por .cursor/hooks/mem-after-agent-response.mjs -->\n';
    fs.writeFileSync(logPath, header + keep, 'utf8');
  }
} catch {
  // ignore rotation errors
}

process.stdout.write('{}\n');
