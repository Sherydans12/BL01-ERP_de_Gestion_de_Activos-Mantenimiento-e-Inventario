/** Caracteres prohibidos en nombres de hoja Excel / ExcelJS. */
const INVALID_SHEET_NAME_CHARS = /[\\/?*[\]:]/g;

const MAX_SHEET_NAME_LENGTH = 31;

/**
 * Normaliza un nombre para `workbook.addWorksheet()`.
 * Excel rechaza `: * ? \ / [ ]` y limita a 31 caracteres.
 */
export function sanitizeExcelWorksheetName(name: string): string {
  const cleaned = name.replace(INVALID_SHEET_NAME_CHARS, '-').trim();
  if (!cleaned || !/[A-Za-z0-9\u00C0-\u024F]/.test(cleaned)) return 'Sheet1';
  return cleaned.slice(0, MAX_SHEET_NAME_LENGTH);
}
