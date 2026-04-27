import { environment } from '../../../environments/environment';

/**
 * Resuelve referencias de medios para frontend:
 * - `http(s)://...` -> se devuelve tal cual.
 * - `/uploads/...` o `/api/...` -> URL absoluta del backend.
 * - `tenants/...` (storageKey) -> endpoint backend protegido `/api/storage/resolve?key=...`.
 */
export function resolveUploadPublicUrl(
  pathOrUrl: string | null | undefined,
): string | null {
  if (!pathOrUrl?.trim()) return null;
  const s = pathOrUrl.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const base = environment.apiUrl.replace(/\/api\/?$/i, '');
  if (s.startsWith('/uploads/') || s.startsWith('/api/')) {
    return `${base}${s.startsWith('/') ? '' : '/'}${s}`;
  }
  return `${environment.apiUrl}/storage/resolve?key=${encodeURIComponent(s)}`;
}
