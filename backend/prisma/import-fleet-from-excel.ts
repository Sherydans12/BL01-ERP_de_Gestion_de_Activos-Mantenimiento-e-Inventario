import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { resolve } from 'node:path';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Error: DATABASE_URL no encontrada. Ejecuta desde backend/ o define DATABASE_URL.',
  );
}

type SheetRow = unknown[];

type CatalogTypeRow = {
  typeName: string;
  family: string;
  shortDescription: string;
  catalogCode: string;
};

type FleetRow = {
  excelRow: number;
  rawInternalId: string;
  internalId: string;
  internalIdWasGenerated: boolean;
  family: string;
  plate: string | null;
  mineInternalId: string | null;
  serialNumber: string | null;
  brand: string;
  model: string;
  year: number | null;
  type: string;
  rawType: string;
  owner: string | null;
  ost: string;
  contractCode: string | null;
  subcontractRaw: string | null;
  subcontractCode: string | null;
  isOperational: boolean;
  statusRaw: string | null;
  meterType: 'HOURS' | 'KILOMETERS';
  meterValue: number;
  meterDate: Date | null;
  lastMaintenanceDate: Date | null;
  lastMaintenanceMeter: number | null;
  pmInterval: number | null;
  techReviewExp: Date | null;
  circPermitExp: Date | null;
  soapExp: Date | null;
  mechanicalCertExp: Date | null;
  liabilityPolicyExp: Date | null;
  isSubleased: boolean;
  ownership: string;
  subleaseCompanyName: string | null;
};

type ImportPlan = {
  catalogTypes: CatalogTypeRow[];
  fleetRows: FleetRow[];
  warnings: string[];
  unknownTypes: string[];
  familyMismatches: string[];
  duplicateRawInternalIds: Map<string, number[]>;
  duplicateRawPlates: Map<string, number[]>;
};

const EQUIPMENT_SHEET_INDEX = 0;
const CATALOG_SHEET_INDEX = 1;
const EQUIPMENT_HEADER_ROW_INDEX = 4;
const EQUIPMENT_DATA_START_INDEX = 5;
const CATALOG_DATA_START_INDEX = 1;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];

  return null;
}

function normalizeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return `${value}`.trim();
  }
  if (value instanceof Date) return value.toISOString();
  return `${value}`.trim();
}

function normalizeKey(value: unknown): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactKey(value: unknown): string {
  return normalizeKey(value).replace(/[^A-Z0-9]+/g, '');
}

function getCell(row: SheetRow, index: number): unknown {
  return row[index] ?? null;
}

function toNullableText(value: unknown): string | null {
  const text = normalizeText(value);
  return text ? text : null;
}

function toCode(value: unknown): string {
  return normalizeKey(value).replace(/[^A-Z0-9-]+/g, '');
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function parseInteger(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  const text = normalizeText(value)
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');
  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseExcelDate(value: unknown): Date | null {
  if (value == null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 1) return null;
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed || parsed.y < 2001) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }

  const text = normalizeText(value);
  if (!text) return null;

  const normalized = normalizeKey(text);
  if (
    normalized === '1-JAN-00' ||
    normalized === '01-JAN-00' ||
    normalized === '1/1/00' ||
    normalized === '01/01/00' ||
    normalized.includes('NO APLICA')
  ) {
    return null;
  }

  const monthMap: Record<string, number> = {
    JAN: 0,
    ENE: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    ABR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    AGO: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11,
    DIC: 11,
  };

  const dashed = normalized.match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/);
  if (dashed) {
    const day = Number(dashed[1]);
    const month = monthMap[dashed[2]];
    const year = normalizeYear(Number(dashed[3]));
    if (month != null && year >= 2001) return new Date(Date.UTC(year, month, day));
    return null;
  }

  const slash = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = normalizeYear(Number(slash[3]));
    if (year < 2001) return null;

    const month = first > 12 ? second - 1 : first - 1;
    const day = first > 12 ? first : second;
    return new Date(Date.UTC(year, month, day));
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) || fallback.getUTCFullYear() < 2001
    ? null
    : new Date(
        Date.UTC(
          fallback.getUTCFullYear(),
          fallback.getUTCMonth(),
          fallback.getUTCDate(),
        ),
      );
}

function normalizeYear(year: number): number {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function normalizePlate(value: unknown): string | null {
  const text = normalizeText(value).toUpperCase();
  if (!text) return null;

  const key = compactKey(text);
  if (
    key === 'SINPATENTE' ||
    key === 'SP' ||
    key === 'NOPATENTE' ||
    key === 'NOAPLICA'
  ) {
    return null;
  }

  return truncate(text.replace(/\s+/g, ''), 20);
}

function normalizeOwner(value: unknown): string | null {
  const owner = normalizeText(value).toUpperCase();
  if (!owner) return null;
  if (compactKey(owner) === 'RSRENTAL') return 'RS RENTAL';
  return truncate(owner, 200);
}

function getContractCodeFromOst(value: unknown): string | null {
  const digits = normalizeText(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.endsWith('0395') || digits.endsWith('395')) return '395';
  if (digits.endsWith('0448') || digits.endsWith('448')) return '448';
  return digits.slice(-3);
}

function normalizeStatus(value: unknown): boolean {
  const status = compactKey(value);
  if (!status) return true;
  return status !== 'FS' && status !== 'FUERADESERVICIO';
}

function normalizeMeterType(value: unknown): 'HOURS' | 'KILOMETERS' {
  const unit = compactKey(value);
  return unit.includes('KM') ? 'KILOMETERS' : 'HOURS';
}

function isDocumentRequired(value: unknown): boolean {
  const key = compactKey(value);
  return key === 'SI' || key === 'YES' || key === 'S';
}

function parseDocumentDate(requiredValue: unknown, dateValue: unknown): Date | null {
  return isDocumentRequired(requiredValue) ? parseExcelDate(dateValue) : null;
}

function buildCatalogRows(rows: SheetRow[]): CatalogTypeRow[] {
  const source = rows
    .slice(CATALOG_DATA_START_INDEX)
    .map((row) => ({
      typeName: truncate(normalizeText(getCell(row, 0)).toUpperCase(), 100),
      family: truncate(toCode(getCell(row, 1)), 20),
      shortDescription: normalizeText(getCell(row, 2)),
    }))
    .filter((row) => row.typeName && row.family);

  const familyTotals = new Map<string, number>();
  for (const row of source) {
    familyTotals.set(row.family, (familyTotals.get(row.family) ?? 0) + 1);
  }

  const familyIndexes = new Map<string, number>();
  return source.map((row) => {
    const total = familyTotals.get(row.family) ?? 0;
    const current = (familyIndexes.get(row.family) ?? 0) + 1;
    familyIndexes.set(row.family, current);

    return {
      ...row,
      catalogCode:
        total > 1 ? `${row.family}-${String(current).padStart(2, '0')}` : row.family,
    };
  });
}

function buildDuplicateMap(rows: FleetRow[], key: (row: FleetRow) => string | null) {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    map.set(value, [...(map.get(value) ?? []), row.excelRow]);
  }

  return new Map([...map.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1));
}

function planFleetRows(
  rows: SheetRow[],
  catalogRows: CatalogTypeRow[],
): Omit<
  ImportPlan,
  'duplicateRawInternalIds' | 'duplicateRawPlates' | 'catalogTypes'
> {
  const warnings: string[] = [];
  const typeByKey = new Map(catalogRows.map((row) => [compactKey(row.typeName), row]));
  const rawRows = rows.slice(EQUIPMENT_DATA_START_INDEX).filter((row) => {
    return normalizeText(getCell(row, 0)) || normalizeText(getCell(row, 8));
  });

  const rawInternalCounts = new Map<string, number>();
  const maxByPrefix = new Map<string, number>();

  for (const row of rawRows) {
    const rawInternalId = normalizeText(getCell(row, 0)).toUpperCase();
    if (!rawInternalId) continue;

    rawInternalCounts.set(rawInternalId, (rawInternalCounts.get(rawInternalId) ?? 0) + 1);
    const match = rawInternalId.match(/^([A-Z]+)(\d+)$/);
    if (match) {
      const [, prefix, suffix] = match;
      maxByPrefix.set(prefix, Math.max(maxByPrefix.get(prefix) ?? 0, Number(suffix)));
    }
  }

  const seenRawInternalIds = new Set<string>();
  const assignedInternalIds = new Set<string>();
  const generatedOffsetsByPrefix = new Map<string, number>();
  const unknownTypes = new Set<string>();
  const familyMismatches = new Set<string>();
  const fleetRows: FleetRow[] = [];

  rawRows.forEach((row, index) => {
    const excelRow = index + EQUIPMENT_DATA_START_INDEX + 1;
    const rawInternalId = normalizeText(getCell(row, 0)).toUpperCase();
    const family = toCode(getCell(row, 1));
    const rawType = normalizeText(getCell(row, 8)).toUpperCase();
    const catalogType = typeByKey.get(compactKey(rawType));
    const type = catalogType?.typeName ?? truncate(rawType, 50);

    if (!rawInternalId) {
      warnings.push(`Fila ${excelRow}: sin N interno, omitida.`);
      return;
    }

    if (!catalogType) {
      unknownTypes.add(`${rawType || '(vacio)'} (fila ${excelRow})`);
    } else if (family && family !== catalogType.family) {
      familyMismatches.add(
        `Fila ${excelRow}: familia ${family} no coincide con ${catalogType.family} para ${catalogType.typeName}`,
      );
    }

    let internalId = rawInternalId;
    let internalIdWasGenerated = false;
    const duplicatedInExcel =
      seenRawInternalIds.has(rawInternalId) || assignedInternalIds.has(rawInternalId);
    if (duplicatedInExcel) {
      const match = rawInternalId.match(/^([A-Z]+)(\d+)$/);
      if (!match) {
        throw new Error(
          `No se puede resolver duplicado de internalId sin patron prefijo+numero: ${rawInternalId}`,
        );
      }

      const [, prefix, suffix] = match;
      let next =
        (maxByPrefix.get(prefix) ?? Number(suffix)) +
        (generatedOffsetsByPrefix.get(prefix) ?? 0) +
        1;
      let candidate = `${prefix}${String(next).padStart(suffix.length, '0')}`;
      while (assignedInternalIds.has(candidate) || rawInternalCounts.has(candidate)) {
        next += 1;
        candidate = `${prefix}${String(next).padStart(suffix.length, '0')}`;
      }

      generatedOffsetsByPrefix.set(
        prefix,
        next - (maxByPrefix.get(prefix) ?? Number(suffix)),
      );
      internalId = candidate;
      internalIdWasGenerated = true;
    }

    seenRawInternalIds.add(rawInternalId);
    assignedInternalIds.add(internalId);

    const owner = normalizeOwner(getCell(row, 11));
    const isSubleased = Boolean(owner && compactKey(owner) !== 'POWERTRAK');
    const pmInterval = parseInteger(getCell(row, 23));
    const meterValue = parseInteger(getCell(row, 19)) ?? 0;

    fleetRows.push({
      excelRow,
      rawInternalId,
      internalId,
      internalIdWasGenerated,
      family,
      plate: normalizePlate(getCell(row, 2)),
      mineInternalId: toNullableText(getCell(row, 3)),
      serialNumber: toNullableText(getCell(row, 4)),
      brand: truncate(normalizeText(getCell(row, 5)).toUpperCase() || 'SIN MARCA', 50),
      model: truncate(normalizeText(getCell(row, 6)).toUpperCase() || 'SIN MODELO', 50),
      year: parseInteger(getCell(row, 7)),
      type,
      rawType,
      owner,
      ost: normalizeText(getCell(row, 12)),
      contractCode: getContractCodeFromOst(getCell(row, 12)),
      subcontractRaw: toNullableText(getCell(row, 13)),
      subcontractCode: null,
      isOperational: normalizeStatus(getCell(row, 15)),
      statusRaw: toNullableText(getCell(row, 15)),
      meterType: normalizeMeterType(getCell(row, 24)),
      meterValue,
      meterDate: parseExcelDate(getCell(row, 20)),
      lastMaintenanceDate: parseExcelDate(getCell(row, 21)),
      lastMaintenanceMeter: parseInteger(getCell(row, 22)),
      pmInterval,
      circPermitExp: parseDocumentDate(getCell(row, 27), getCell(row, 28)),
      techReviewExp: parseDocumentDate(getCell(row, 29), getCell(row, 30)),
      liabilityPolicyExp: parseDocumentDate(getCell(row, 31), getCell(row, 32)),
      soapExp: parseDocumentDate(getCell(row, 33), getCell(row, 34)),
      mechanicalCertExp: parseDocumentDate(getCell(row, 35), getCell(row, 36)),
      isSubleased,
      ownership: isSubleased ? 'ARRENDADO' : 'PROPIO',
      subleaseCompanyName: isSubleased ? owner : null,
    });
  });

  return {
    fleetRows,
    warnings,
    unknownTypes: [...unknownTypes],
    familyMismatches: [...familyMismatches],
  };
}

function formatDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function printPlanSummary(plan: ImportPlan, workbook: XLSX.WorkBook): void {
  const equipmentSheetName = workbook.SheetNames[EQUIPMENT_SHEET_INDEX];
  const catalogSheetName = workbook.SheetNames[CATALOG_SHEET_INDEX];
  const generatedIds = plan.fleetRows.filter((row) => row.internalIdWasGenerated);
  const nullPlates = plan.fleetRows.filter((row) => row.plate == null).length;
  const subleased = plan.fleetRows.filter((row) => row.isSubleased).length;
  const operational = plan.fleetRows.filter((row) => row.isOperational).length;
  const kilometers = plan.fleetRows.filter((row) => row.meterType === 'KILOMETERS').length;
  const withMaintenance = plan.fleetRows.filter(
    (row) => row.lastMaintenanceDate || row.lastMaintenanceMeter != null,
  ).length;

  console.log('\n=== Analisis import_flota.xlsx ===');
  console.log(`Hoja equipos: ${equipmentSheetName}`);
  console.log(`Hoja catalogo tipos: ${catalogSheetName}`);
  console.log(`Tipos catalogo a upsert: ${plan.catalogTypes.length}`);
  console.log(`Equipos a upsert: ${plan.fleetRows.length}`);
  console.log(`Patentes normalizadas a null: ${nullPlates}`);
  console.log(`Equipos subarrendados/externos: ${subleased}`);
  console.log(`Operativos: ${operational} / Fuera de servicio: ${plan.fleetRows.length - operational}`);
  console.log(`Medidores KM: ${kilometers} / HOURS: ${plan.fleetRows.length - kilometers}`);
  console.log(`Equipos con info PM: ${withMaintenance}`);

  if (generatedIds.length) {
    console.log('\nIDs internos duplicados resueltos:');
    for (const row of generatedIds) {
      console.log(`- Excel fila ${row.excelRow}: ${row.rawInternalId} -> ${row.internalId}`);
    }
  }

  if (plan.duplicateRawPlates.size) {
    console.log('\nPatentes duplicadas en Excel antes de normalizar:');
    for (const [plate, rows] of plan.duplicateRawPlates) {
      console.log(`- ${plate}: filas ${rows.join(', ')}`);
    }
  }

  if (plan.unknownTypes.length) {
    console.log('\nTipos no encontrados en hoja 2:');
    for (const type of plan.unknownTypes) console.log(`- ${type}`);
  }

  if (plan.familyMismatches.length) {
    console.log('\nDiferencias familia vs hoja 2:');
    for (const mismatch of plan.familyMismatches) console.log(`- ${mismatch}`);
  }

  if (plan.warnings.length) {
    console.log('\nAdvertencias:');
    for (const warning of plan.warnings) console.log(`- ${warning}`);
  }

  console.log('\nCatalogo EQUIPMENT_TYPE planificado:');
  for (const row of plan.catalogTypes) {
    console.log(`- ${row.catalogCode}: ${row.typeName} (${row.family})`);
  }

  console.log('\nColumnas leidas pero sin campo directo en Equipment actual:');
  console.log(
    '- Descripcion adicional, fecha ingreso faena, gerencia, ubicacion, observacion, responsable, proxima PM, horas faltantes, desmovilizado y fecha desmovilizado.',
  );

  console.log('\nMuestra equipos:');
  for (const row of plan.fleetRows.slice(0, 8)) {
    console.log(
      `- ${row.internalId} | ${row.type} | ${row.brand} ${row.model} | patente ${
        row.plate ?? 'NULL'
      } | contrato ${row.contractCode ?? 'NULL'} | PM ${row.pmInterval ?? 'NULL'} | docs ${[
        formatDate(row.circPermitExp),
        formatDate(row.techReviewExp),
        formatDate(row.liabilityPolicyExp),
        formatDate(row.soapExp),
        formatDate(row.mechanicalCertExp),
      ]
        .filter(Boolean)
        .join(', ')}`,
    );
  }
}

async function buildImportPlan(filePath: string): Promise<ImportPlan> {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const equipmentSheet = workbook.Sheets[workbook.SheetNames[EQUIPMENT_SHEET_INDEX]];
  const catalogSheet = workbook.Sheets[workbook.SheetNames[CATALOG_SHEET_INDEX]];

  if (!equipmentSheet || !catalogSheet) {
    throw new Error('El archivo debe tener hoja 1 de equipos y hoja 2 de tipos.');
  }

  const equipmentRows = XLSX.utils.sheet_to_json<SheetRow>(equipmentSheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const catalogRows = XLSX.utils.sheet_to_json<SheetRow>(catalogSheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const header = equipmentRows[EQUIPMENT_HEADER_ROW_INDEX] ?? [];
  if (compactKey(getCell(header, 0)) !== 'NINTERNO') {
    throw new Error(
      'No se encontro la fila de encabezados esperada en hoja 1 (fila 5, columna A: N interno).',
    );
  }

  const catalogTypes = buildCatalogRows(catalogRows);
  if (!catalogTypes.length) {
    throw new Error('No se encontraron tipos de equipo en la hoja 2.');
  }

  const partialPlan = planFleetRows(equipmentRows, catalogTypes);
  const duplicateRawInternalIds = buildDuplicateMap(
    partialPlan.fleetRows,
    (row) => row.rawInternalId,
  );
  const duplicateRawPlates = buildDuplicateMap(partialPlan.fleetRows, (row) => row.plate);

  return {
    catalogTypes,
    ...partialPlan,
    duplicateRawInternalIds,
    duplicateRawPlates,
  };
}

async function resolveTenantId(): Promise<string> {
  const envTenantId = process.env.EXCEL_IMPORT_TENANT_ID;
  if (envTenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: envTenantId } });
    if (!tenant) throw new Error(`Tenant no encontrado: ${envTenantId}`);
    return tenant.id;
  }

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) throw new Error('No existe tenant en la base local.');
  return tenant.id;
}

async function importCatalogTypes(tenantId: string, rows: CatalogTypeRow[]) {
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.catalogItem.findUnique({
      where: { tenantId_code: { tenantId, code: row.catalogCode } },
      select: { id: true, category: true },
    });

    if (existing && existing.category !== 'EQUIPMENT_TYPE') {
      throw new Error(
        `El codigo de catalogo ${row.catalogCode} ya existe en otra categoria (${existing.category}).`,
      );
    }

    await prisma.catalogItem.upsert({
      where: { tenantId_code: { tenantId, code: row.catalogCode } },
      update: {
        name: row.typeName,
        category: 'EQUIPMENT_TYPE',
        isActive: true,
      },
      create: {
        tenantId,
        code: row.catalogCode,
        name: row.typeName,
        category: 'EQUIPMENT_TYPE',
        isActive: true,
      },
    });

    if (existing) updated += 1;
    else created += 1;
  }

  return { created, updated };
}

async function importFleetRows(tenantId: string, rows: FleetRow[]) {
  const contracts = await prisma.contract.findMany({
    where: { tenantId },
    select: { id: true, code: true },
  });
  const contractByCode = new Map(contracts.map((contract) => [contract.code, contract]));

  const subcontracts = await prisma.subcontract.findMany({
    where: { contract: { tenantId } },
    select: { id: true, code: true, name: true, contract: { select: { code: true } } },
  });
  const subcontractByKey = new Map<
    string,
    { id: string; code: string; name: string; contract: { code: string } }
  >();
  for (const subcontract of subcontracts) {
    const contractCode = compactKey(subcontract.contract.code);
    const code = compactKey(subcontract.code);
    const suffix = compactKey(subcontract.code.split('-').at(-1));
    subcontractByKey.set(`${contractCode}:${code}`, subcontract);
    subcontractByKey.set(`${contractCode}:${suffix}`, subcontract);
    subcontractByKey.set(`${contractCode}:${compactKey(subcontract.name)}`, subcontract);
  }

  let created = 0;
  let updated = 0;
  const missingContracts = new Set<string>();
  const missingSubcontracts = new Set<string>();

  for (const row of rows) {
    const contract = row.contractCode ? contractByCode.get(row.contractCode) : null;
    if (row.contractCode && !contract) missingContracts.add(row.contractCode);

    const subcontract =
      row.subcontractRaw != null && row.contractCode
        ? subcontractByKey.get(`${compactKey(row.contractCode)}:${compactKey(row.subcontractRaw)}`)
        : null;
    if (row.subcontractRaw && !subcontract) missingSubcontracts.add(row.subcontractRaw);

    const existing = await prisma.equipment.findUnique({
      where: { tenantId_internalId: { tenantId, internalId: row.internalId } },
      select: { id: true },
    });

    const data = {
      tenantId,
      contractId: contract?.id ?? null,
      subcontractId: subcontract?.id ?? null,
      mineInternalId: row.mineInternalId ? truncate(row.mineInternalId, 50) : null,
      internalId: truncate(row.internalId, 50),
      plate: row.plate,
      type: truncate(row.type, 50),
      brand: row.brand,
      model: row.model,
      meterType: row.meterType,
      initialMeter: row.meterValue,
      currentMeter: row.meterValue,
      serialNumber: row.serialNumber ? truncate(row.serialNumber, 80) : null,
      year: row.year,
      ownership: truncate(row.ownership, 50),
      isSubleased: row.isSubleased,
      subleaseCompanyName: row.subleaseCompanyName,
      maintenanceFrequency: row.pmInterval,
      pmIntervalOverride: row.pmInterval,
      lastMaintenanceDate: row.lastMaintenanceDate,
      lastMaintenanceMeter: row.lastMaintenanceMeter,
      circPermitExp: row.circPermitExp,
      techReviewExp: row.techReviewExp,
      liabilityPolicyExp: row.liabilityPolicyExp,
      soapExp: row.soapExp,
      mechanicalCertExp: row.mechanicalCertExp,
      isOperational: row.isOperational,
    };

    await prisma.equipment.upsert({
      where: { tenantId_internalId: { tenantId, internalId: row.internalId } },
      update: {
        contractId: data.contractId,
        subcontractId: data.subcontractId,
        mineInternalId: data.mineInternalId,
        plate: data.plate,
        type: data.type,
        brand: data.brand,
        model: data.model,
        meterType: data.meterType,
        initialMeter: data.initialMeter,
        currentMeter: data.currentMeter,
        serialNumber: data.serialNumber,
        year: data.year,
        ownership: data.ownership,
        isSubleased: data.isSubleased,
        subleaseCompanyName: data.subleaseCompanyName,
        maintenanceFrequency: data.maintenanceFrequency,
        pmIntervalOverride: data.pmIntervalOverride,
        lastMaintenanceDate: data.lastMaintenanceDate,
        lastMaintenanceMeter: data.lastMaintenanceMeter,
        circPermitExp: data.circPermitExp,
        techReviewExp: data.techReviewExp,
        liabilityPolicyExp: data.liabilityPolicyExp,
        soapExp: data.soapExp,
        mechanicalCertExp: data.mechanicalCertExp,
        isOperational: data.isOperational,
      },
      create: data,
    });

    if (existing) updated += 1;
    else created += 1;
  }

  return {
    created,
    updated,
    missingContracts: [...missingContracts],
    missingSubcontracts: [...missingSubcontracts],
  };
}

async function verifyImport(tenantId: string, expectedFleetRows: number) {
  const [equipmentCount, catalogCount, nullPlateCount, duplicatePlates, duplicateInternalIds] =
    await Promise.all([
      prisma.equipment.count({ where: { tenantId } }),
      prisma.catalogItem.count({
        where: { tenantId, category: 'EQUIPMENT_TYPE', isActive: true },
      }),
      prisma.equipment.count({ where: { tenantId, plate: null } }),
      prisma.$queryRaw<{ plate: string; count: bigint }[]>`
        SELECT plate, COUNT(*)::bigint AS count
        FROM equipments
        WHERE tenant_id = ${tenantId}::uuid AND plate IS NOT NULL
        GROUP BY plate
        HAVING COUNT(*) > 1
      `,
      prisma.$queryRaw<{ internal_id: string; count: bigint }[]>`
        SELECT internal_id, COUNT(*)::bigint AS count
        FROM equipments
        WHERE tenant_id = ${tenantId}::uuid
        GROUP BY internal_id
        HAVING COUNT(*) > 1
      `,
    ]);

  console.log('\n=== Verificacion DB ===');
  console.log(`Equipos totales tenant: ${equipmentCount}`);
  console.log(`Equipos esperados desde Excel en esta corrida: ${expectedFleetRows}`);
  console.log(`Catalogos EQUIPMENT_TYPE activos: ${catalogCount}`);
  console.log(`Equipos con patente null: ${nullPlateCount}`);
  console.log(`Patentes duplicadas no-null: ${duplicatePlates.length}`);
  console.log(`IDs internos duplicados: ${duplicateInternalIds.length}`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const fileArg = getArg('file');
  const filePath = resolve(fileArg ?? resolve(process.cwd(), '..', 'import_flota.xlsx'));

  console.log(`Archivo: ${filePath}`);
  console.log(`Modo: ${dryRun ? 'dry-run' : 'importacion real'}`);

  const plan = await buildImportPlan(filePath);
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  printPlanSummary(plan, workbook);

  if (dryRun) {
    console.log('\nDry-run finalizado: no se escribio en la base.');
    return;
  }

  const tenantId = await resolveTenantId();
  const catalogResult = await importCatalogTypes(tenantId, plan.catalogTypes);
  const fleetResult = await importFleetRows(tenantId, plan.fleetRows);

  console.log('\n=== Resultado importacion ===');
  console.log(
    `Catalogos creados: ${catalogResult.created} | actualizados: ${catalogResult.updated}`,
  );
  console.log(`Equipos creados: ${fleetResult.created} | actualizados: ${fleetResult.updated}`);

  if (fleetResult.missingContracts.length) {
    console.log(`Contratos no encontrados: ${fleetResult.missingContracts.join(', ')}`);
  }
  if (fleetResult.missingSubcontracts.length) {
    console.log(`Subcontratos no encontrados: ${fleetResult.missingSubcontracts.join(', ')}`);
  }

  await verifyImport(tenantId, plan.fleetRows.length);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
