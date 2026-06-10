import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';

export type BaseLogicImportDomain = 'fleet' | 'inventory';

export type ParsedMasterImportRow = {
  rowNumber: number;
  values: Record<string, unknown>;
};

export type ParsedMasterImportWorkbook = {
  domain: BaseLogicImportDomain;
  version: string;
  primarySheet: string;
  headerRow: number;
  firstDataRow: number;
  rows: ParsedMasterImportRow[];
};

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'text' in value) {
    return cellText((value as { text?: unknown }).text);
  }
  if (typeof value === 'object' && 'result' in value) {
    return cellText((value as { result?: unknown }).result);
  }
  return JSON.stringify(value).trim();
}

export function normalizeImportText(value: unknown): string {
  return cellText(value).replace(/\s+/g, ' ').trim();
}

export function normalizeImportKey(value: unknown): string {
  return normalizeImportText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

export function parseImportBoolean(value: unknown): boolean | null {
  const key = normalizeImportKey(value);
  if (!key) return null;
  if (['SI', 'S', 'YES', 'TRUE', '1'].includes(key)) return true;
  if (['NO', 'N', 'FALSE', '0'].includes(key)) return false;
  return null;
}

export function parseImportNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeImportText(value).replace(/\./g, '').replace(',', '.');
  if (!text) return null;
  const parsed = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseImportInt(value: unknown): number | null {
  const parsed = parseImportNumber(value);
  return parsed == null ? null : Math.round(parsed);
}

export function parseImportDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    );
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = Math.round((value - 25569) * 86400 * 1000);
    const parsed = new Date(millis);
    return new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
      ),
    );
  }
  const text = normalizeImportText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function getImportString(
  values: Record<string, unknown>,
  header: string,
): string {
  return normalizeImportText(values[header]);
}

export function getImportNullableString(
  values: Record<string, unknown>,
  header: string,
): string | null {
  const text = getImportString(values, header);
  return text ? text : null;
}

function readInfoSheetValue(info: ExcelJS.Worksheet, key: string): string {
  for (let row = 1; row <= info.rowCount; row += 1) {
    const rowKey = normalizeImportText(info.getRow(row).getCell(1).value);
    if (rowKey === key) {
      return normalizeImportText(info.getRow(row).getCell(2).value);
    }
  }
  return '';
}

export async function parseBaseLogicMasterImportWorkbook(
  buffer: Buffer,
  expectedDomain: BaseLogicImportDomain,
): Promise<ParsedMasterImportWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new BadRequestException('El archivo no es un Excel valido (.xlsx).');
  }

  const info = workbook.getWorksheet('_bl_import_contract');
  if (!info) {
    throw new BadRequestException(
      'El archivo no corresponde a un maestro BaseLogic exportado desde el sistema.',
    );
  }

  const domain = readInfoSheetValue(info, 'domain') as BaseLogicImportDomain;
  if (domain !== expectedDomain) {
    throw new BadRequestException(
      `El archivo corresponde a ${domain || 'otro dominio'}, no a ${expectedDomain}.`,
    );
  }

  const version = readInfoSheetValue(info, 'version') || '1';
  const primarySheet =
    readInfoSheetValue(info, 'primarySheet') ||
    (expectedDomain === 'fleet' ? 'Flota' : 'Inventario');
  const headerRow = Number(readInfoSheetValue(info, 'headerRow') || 5);
  const firstDataRow = Number(readInfoSheetValue(info, 'firstDataRow') || 6);
  const dataSheet = workbook.getWorksheet(primarySheet);
  if (!dataSheet) {
    throw new BadRequestException(`No se encontro la hoja ${primarySheet}.`);
  }

  const headers: string[] = [];
  const header = dataSheet.getRow(headerRow);
  header.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = normalizeImportText(cell.value);
    if (text) headers[colNumber] = text;
  });

  if (!headers.length) {
    throw new BadRequestException(
      'No se encontraron encabezados validos en el Excel.',
    );
  }

  const rows: ParsedMasterImportRow[] = [];
  for (
    let rowNumber = firstDataRow;
    rowNumber <= dataSheet.rowCount;
    rowNumber += 1
  ) {
    const row = dataSheet.getRow(rowNumber);
    const values: Record<string, unknown> = {};
    let hasValue = false;
    for (let colNumber = 1; colNumber < headers.length; colNumber += 1) {
      const headerName = headers[colNumber];
      if (!headerName) continue;
      const value = row.getCell(colNumber).value;
      if (normalizeImportText(value)) hasValue = true;
      values[headerName] = value;
    }
    if (hasValue) rows.push({ rowNumber, values });
  }

  return {
    domain,
    version,
    primarySheet,
    headerRow,
    firstDataRow,
    rows,
  };
}
