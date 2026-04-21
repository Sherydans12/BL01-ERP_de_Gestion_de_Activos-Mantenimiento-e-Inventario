import { environment } from '../../../environments/environment';

/**
 * Convierte una ruta pública del backend (`/uploads/...`) en URL absoluta para `<img src>`.
 * Si ya es http(s), se devuelve tal cual.
 */
export function resolveUploadPublicUrl(
  pathOrUrl: string | null | undefined,
): string | null {
  if (!pathOrUrl?.trim()) return null;
  const s = pathOrUrl.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const base = environment.apiUrl.replace(/\/api\/?$/i, '');
  return `${base}${s.startsWith('/') ? '' : '/'}${s}`;
}
