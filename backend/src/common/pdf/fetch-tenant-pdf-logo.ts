import { StorageService } from '../storage/storage.service';

/** Logo tenant embebido en HTML del PDF (evita URLs firmadas inaccesibles desde Chromium). */
export async function fetchTenantPdfLogoDataUri(
  storage: StorageService,
  storageKey: string | null | undefined,
): Promise<string | null> {
  const raw = storageKey?.trim();
  if (!raw) return null;
  try {
    const url = (await storage.getReadOnlyUrl(raw)).trim();
    if (!url) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct =
      res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2_500_000) return null;
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
