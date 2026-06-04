import { BadRequestException } from '@nestjs/common';
import {
  defaultFullReportOptions,
  ValuationFullReportOptions,
} from './full-report-options.types';

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'si', 'sí'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  return fallback;
}

function parseCsv(value: string | undefined): string[] | null {
  if (!value?.trim()) return null;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException(`Valor numérico inválido: ${value}`);
  }
  return Math.min(n, max);
}

function parseOptionalPositiveInt(
  value: string | undefined,
  max: number,
): number | null {
  if (value === undefined || value === '' || value === '0') return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new BadRequestException(`Valor numérico inválido: ${value}`);
  }
  return Math.min(n, max);
}

/**
 * Convierte query string del GET full-report en opciones tipadas.
 * Parámetros omitidos conservan el default (todo incluido).
 */
export function parseFullReportQuery(
  query: Record<string, string | undefined>,
): ValuationFullReportOptions {
  const base = defaultFullReportOptions();

  const sections = {
    warehouseSummary: parseBool(
      query.includeWarehouseSummary,
      base.sections.warehouseSummary,
    ),
    familySummary: parseBool(
      query.includeFamilySummary,
      base.sections.familySummary,
    ),
    criticalItems: parseBool(
      query.includeCritical,
      base.sections.criticalItems,
    ),
    deadStock: parseBool(query.includeDeadStock, base.sections.deadStock),
    itemDetail: parseBool(query.includeItemDetail, base.sections.itemDetail),
    purchases: parseBool(query.includePurchases, base.sections.purchases),
  };

  if (
    !sections.warehouseSummary &&
    !sections.familySummary &&
    !sections.criticalItems &&
    !sections.deadStock &&
    !sections.itemDetail &&
    !sections.purchases
  ) {
    throw new BadRequestException(
      'Debe incluir al menos una sección en el reporte.',
    );
  }

  return {
    sections,
    filters: {
      warehouseIds: parseCsv(query.warehouseIds),
      familyNames: parseCsv(query.familyNames),
      onlyWithStock: parseBool(query.onlyWithStock, false),
    },
    limits: {
      detailMaxRows: parseOptionalPositiveInt(query.detailMaxRows, 50_000),
      criticalMaxRows: parsePositiveInt(query.criticalMaxRows, 10, 500),
      deadStockMaxRows: parsePositiveInt(query.deadStockMaxRows, 20, 500),
      purchaseMaxRows: parsePositiveInt(query.purchaseMaxRows, 100, 500),
    },
  };
}
