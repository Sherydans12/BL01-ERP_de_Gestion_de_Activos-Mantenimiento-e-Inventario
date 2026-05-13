import * as dotenv from 'dotenv';
import { Prisma, PrismaClient, TransactionType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Error: DATABASE_URL no encontrada. Asegúrate de que el archivo .env existe en la carpeta backend',
  );
}

type RawRow = Record<string, unknown>;
type SheetMatrix = unknown[][];

const SHEET_ROPA_INVIERNO = 'ROPA_INVIERNO';
const INTERNAL_CONTRACT_CODE = '000';
const INTERNAL_CONTRACT_NAME = 'ADMINISTRACIÓN INTERNA';
const GENERAL_WAREHOUSE_NAME = 'Bodega General';
const GENERAL_WAREHOUSE_CODE = 'BOD-GENERAL';
const DEFAULT_SUBCATEGORY_NAME = 'General';
const PRESERVED_CONTRACT_CODES = [
  '395',
  '448',
  '448-414',
  '448-416',
  INTERNAL_CONTRACT_CODE,
] as const;
const STATUS_WORDS = new Set([
  'STOCK OK',
  'STOCK CRITICO',
  'STOCK CRÍTICO',
  'SIN STOCK',
  'ERROR',
]);

const HEADER_CANDIDATES = {
  item: [
    'item',
    'nombre',
    'articulo',
    'artículo',
    'producto',
    'descripcion de elemento',
    'nombre del elemento',
    'nombre del articulo',
  ],
  /** SKU interno ERP (columna típica "ID de Inventario"). */
  inventoryCode: [
    'id de inventario',
    'id inventario',
    'codigo inventario',
    'código inventario',
    'identificador de inventario',
    'identificador inventario',
  ],
  partNumber: [
    'codigo',
    'código',
    'cod',
    'sku',
    'numero de parte',
    'n° parte',
    'n parte',
    'part number',
    'p/n',
  ],
  stock: [
    'cantidad en existencias',
    'stock',
    'cantidad',
    'existencia',
    'saldo',
  ],
  minStock: [
    'stock minimo',
    'stock mínimo',
    'minimo',
    'mínimo',
    'min stock',
    'stock critico',
    'stock crítico',
    'critico',
    'crítico',
  ],
  unitCost: [
    'precio por unidad',
    'precio',
    'valor unitario',
    'unit cost',
    'costo',
  ],
  description: [
    'descripcion',
    'descripción',
    'detalle',
    'presentacion',
    'tipo sae',
  ],
  brand: ['marca/modelo', 'marca', 'modelo'],
  sector: ['sector', 'bodega'],
  /** Ubicación física en bodega (pasillo/estante); si falta, se puede derivar del sector en import Insumos. */
  stockLocation: [
    'ubicacion',
    'ubicación',
    'localizacion',
    'localización',
    'pasillo',
    'estante',
    'coordenada',
  ],
  contract: ['contrato'],
  category: ['categoria', 'categoría', 'familia', 'grupo', 'recursos operativos', 'recurso operativo'],
  subfamily: ['subdivision', 'subfamilia', 'sub familia', 'sub-familia'],
  supplier: ['proveedor', 'supplier', 'proveedor habitual'],
  // sin "unidad" suelto para evitar colisión con "precio por unidad"
  uom: ['uom', 'unidad medida', 'unidad de medida', 'um'],
} as const;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (typeof value === 'object') return JSON.stringify(value).trim();
  return '';
}

function normalizeKey(value: unknown): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeSheetKey(value: string): string {
  return normalizeKey(value).replace(/[\s-]+/g, '_');
}

function formatSubcategoryName(name: string): string {
  return normalizeText(name).replace(/_/g, ' ');
}

function getSheetBaseName(sheetName: string): string {
  return normalizeSheetKey(sheetName).replace(/_(\d{3,}|\d{3,}-\d{2,})$/, '');
}

function isCafeteriaSheet(sheetName: string): boolean {
  return getSheetBaseName(sheetName) === 'CAFETERIA';
}
function isOfficeSheet(sheetName: string): boolean {
  return getSheetBaseName(sheetName) === 'OFICINA';
}
function isEppSheet(sheetName: string): boolean {
  return getSheetBaseName(sheetName) === 'EPP';
}
function isRopaInviernoSheet(sheetName: string): boolean {
  return normalizeSheetKey(sheetName) === SHEET_ROPA_INVIERNO;
}

function shortStableHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1)
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function buildCatalogPartNumber(
  prefix: 'CAF' | 'OFF' | 'EPP' | 'ROP' | 'INS' | 'JAU' | 'PAN',
  name: string,
  description: string,
): string {
  const base = normalizeKey(`${name}|${description || 'GEN'}`);
  const slugName = normalizeKey(name).replace(/[^A-Z0-9]+/g, '-');
  const slugDesc = normalizeKey(description || 'GEN').replace(
    /[^A-Z0-9]+/g,
    '-',
  );
  return `${prefix}-${slugName}-${slugDesc}-${shortStableHash(base)}`.slice(
    0,
    50,
  );
}

function isLikelyCodeOnlyName(name: string): boolean {
  const normalized = normalizeKey(name);
  return /^IN\d{3,}$/.test(normalized) || /^XLS-\d+$/.test(normalized);
}

function normalizeInventoryCode(code: string): string {
  const normalized = normalizeKey(code).replace(/\s+/g, '');
  if (normalized.startsWith('IN')) {
    const suffix = normalized.slice(2).replace(/O/g, '0');
    if (/^\d+$/.test(suffix)) {
      return `IN${suffix}`;
    }
  }
  return normalized;
}

function shouldSkipCodeLikeRow(name: string, description: string): boolean {
  if (isLikelyCodeOnlyName(name) && !normalizeKey(description)) return true;
  if (!normalizeKey(name) && !normalizeKey(description)) return true;
  return false;
}

function shouldSkipOfficeRow(
  sheetName: string,
  rawPartNumber: string,
  name: string,
  description: string,
): boolean {
  const normalizedSheet = normalizeSheetKey(sheetName);
  const normalizedPart = normalizeKey(rawPartNumber);
  if (
    normalizedSheet === 'OFICINA_448' &&
    ['IN0017', 'IN0018', 'IN0019'].includes(normalizedPart)
  ) {
    return true;
  }
  return shouldSkipCodeLikeRow(name, description);
}

function shouldSkipEppRow(name: string, description: string): boolean {
  return shouldSkipCodeLikeRow(name, description);
}

function shouldSkipRopaRow(name: string, description: string): boolean {
  return shouldSkipCodeLikeRow(name, description);
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (STATUS_WORDS.has(normalizeKey(normalized))) return null;

  let cleaned = normalized.replace(/[^\d,.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === ',' || cleaned === '.')
    return null;
  const negative = cleaned.startsWith('-');
  cleaned = cleaned.replace(/-/g, '');
  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    const decimalSep =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    cleaned = cleaned.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (commaCount > 0) {
    const idx = cleaned.lastIndexOf(',');
    const decimals = cleaned.length - idx - 1;
    cleaned =
      commaCount > 1 || decimals === 3
        ? cleaned.replace(/,/g, '')
        : cleaned.replace(',', '.');
  } else if (dotCount > 1) {
    cleaned = cleaned.replace(/\./g, '');
  } else if (dotCount === 1) {
    const idx = cleaned.lastIndexOf('.');
    const decimals = cleaned.length - idx - 1;
    if (decimals === 3) cleaned = cleaned.replace('.', '');
  }

  const result = Number(`${negative ? '-' : ''}${cleaned}`);
  return Number.isFinite(result) ? result : null;
}

function parseQuantity(value: unknown): number {
  const parsed = parseNumber(value);
  if (parsed == null || parsed < 0) return 0;
  return parsed;
}

function isMissingUnitPrice(value: unknown): boolean {
  const raw = normalizeText(value);
  const compact = raw.replace(/\s+/g, '');
  return !compact || compact === '$-' || compact === '-' || compact === '$';
}

function getColumnKey(
  row: RawRow,
  candidates: readonly string[],
): string | null {
  for (const key of Object.keys(row)) {
    const keyNorm = normalizeKey(key);
    if (candidates.some((c) => keyNorm.includes(normalizeKey(c)))) return key;
  }
  return null;
}

function countHeaderMatches(row: unknown[]): number {
  const normalizedCells = row.map((cell) => normalizeKey(cell));
  let matches = 0;
  for (const group of Object.values(HEADER_CANDIDATES)) {
    if (
      normalizedCells.some((cell) =>
        group.some((c) => cell.includes(normalizeKey(c))),
      )
    ) {
      matches += 1;
    }
  }
  return matches;
}

function discoverHeaderRowIndex(matrix: SheetMatrix): number {
  let bestRow = -1;
  let bestScore = 0;
  const limit = Math.min(20, matrix.length);
  for (let i = 0; i < limit; i += 1) {
    const score = countHeaderMatches(matrix[i] ?? []);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  if (bestRow < 0 || bestScore < 2) {
    throw new Error(
      'No se detectó una fila de encabezados confiable en las primeras 20 filas.',
    );
  }
  return bestRow;
}

function buildRowsFromDiscoveredHeader(matrix: SheetMatrix): RawRow[] {
  const headerRowIndex = discoverHeaderRowIndex(matrix);
  const headerRow = matrix[headerRowIndex] ?? [];
  const rows: RawRow[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const dataRow = matrix[i] ?? [];
    if (dataRow.every((cell) => normalizeText(cell) === '')) continue;
    const row: RawRow = {};
    for (let col = 0; col < headerRow.length; col += 1) {
      const key = normalizeText(headerRow[col]);
      if (!key) continue;
      row[key] = dataRow[col] ?? '';
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

function extractFamilyFromSheetName(sheetName: string): string {
  const normalized = normalizeSheetKey(sheetName);
  if (normalized === SHEET_ROPA_INVIERNO) return 'ROPA';
  const [family] = normalized.split('_');
  return family || 'GENERAL';
}

function extractPartAndName(
  row: RawRow,
  partNumberKey: string | null,
  itemKey: string | null,
): { partNumber: string; name: string } | null {
  const rawPart = partNumberKey ? normalizeText(row[partNumberKey]) : '';
  const rawItem = itemKey ? normalizeText(row[itemKey]) : '';
  if (!rawPart && !rawItem) return null;
  const combined = rawItem || rawPart;
  const split = combined.match(/^([A-Za-z0-9._/-]+)\s*[-–]\s*(.+)$/);
  const partFromCombined = split ? normalizeText(split[1]) : '';
  const nameFromCombined = split ? normalizeText(split[2]) : '';
  const partNumber = normalizeText(rawPart || partFromCombined);
  const normalizedPart = normalizeInventoryCode(partNumber);
  const name = normalizeText(
    rawItem ? (split ? nameFromCombined : rawItem) : nameFromCombined,
  );
  if (!name && !partNumber) return null;
  return {
    partNumber: normalizedPart || partNumber,
    name: name || normalizedPart || partNumber,
  };
}

async function resolveTenantId(): Promise<string> {
  const tenantId = process.env.EXCEL_IMPORT_TENANT_ID?.trim();
  if (tenantId) return tenantId;
  const code = process.env.EXCEL_IMPORT_TENANT_CODE?.trim();
  if (code) {
    const tenant = await prisma.tenant.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!tenant) throw new Error(`No existe tenant con code=${code}.`);
    return tenant.id;
  }
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    take: 2,
  });
  if (tenants.length !== 1) {
    throw new Error(
      'Defina EXCEL_IMPORT_TENANT_ID o EXCEL_IMPORT_TENANT_CODE.',
    );
  }
  return tenants[0].id;
}

async function resolveUserId(tenantId: string): Promise<string> {
  const userId = process.env.EXCEL_IMPORT_USER_ID?.trim();
  if (userId) return userId;
  const byEmail = process.env.EXCEL_IMPORT_USER_EMAIL?.trim();
  if (byEmail) {
    const user = await prisma.user.findUnique({
      where: { email: byEmail },
      select: { id: true },
    });
    if (!user) throw new Error(`No existe user con email=${byEmail}.`);
    return user.id;
  }
  const user = await prisma.user.findFirst({
    where: { tenantId },
    select: { id: true },
  });
  if (!user) throw new Error('No existe usuario para registrar transacciones.');
  return user.id;
}

async function resolveContractForSheet(tenantId: string, sheetName: string) {
  const key = normalizeSheetKey(sheetName);
  if (key === SHEET_ROPA_INVIERNO) {
    return prisma.contract.upsert({
      where: { tenantId_code: { tenantId, code: INTERNAL_CONTRACT_CODE } },
      update: { name: INTERNAL_CONTRACT_NAME, isActive: true },
      create: {
        tenantId,
        code: INTERNAL_CONTRACT_CODE,
        name: INTERNAL_CONTRACT_NAME,
        isActive: true,
      },
      select: { id: true, code: true },
    });
  }
  if (key.endsWith('395')) {
    const found = await prisma.contract.findFirst({
      where: {
        tenantId,
        OR: [{ code: '395' }, { code: { startsWith: '395' } }],
      },
      select: { id: true, code: true },
    });
    if (found) return found;
    return prisma.contract.create({
      data: { tenantId, code: '395', name: 'Contrato 395', isActive: true },
      select: { id: true, code: true },
    });
  }
  if (key.endsWith('448')) {
    const found = await prisma.contract.findFirst({
      where: {
        tenantId,
        OR: [{ code: '448' }, { code: { startsWith: '448' } }],
      },
      select: { id: true, code: true },
    });
    if (found) return found;
    return prisma.contract.create({
      data: { tenantId, code: '448', name: 'Contrato 448', isActive: true },
      select: { id: true, code: true },
    });
  }
  return prisma.contract.findFirst({
    where: { tenantId },
    select: { id: true, code: true },
  });
}

async function getOrCreateWarehouse(tenantId: string, sheetName: string) {
  const contract = await resolveContractForSheet(tenantId, sheetName);
  if (!contract)
    throw new Error(`No se encontró contrato para hoja "${sheetName}".`);
  const sheetKey = normalizeSheetKey(sheetName);
  const isGeneral = sheetKey === SHEET_ROPA_INVIERNO;
  const code = isGeneral
    ? GENERAL_WAREHOUSE_CODE
    : `BOD-XL-${sheetKey}`.slice(0, 50);
  const name = isGeneral ? GENERAL_WAREHOUSE_NAME : `Bodega ${sheetName}`;
  return prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId, code } },
    update: { name, contractId: contract.id, isActive: true },
    create: {
      tenantId,
      contractId: contract.id,
      code,
      name,
      type: 'PHYSICAL',
      isActive: true,
    },
  });
}

async function findOrCreateCategory(
  tenantId: string,
  name: string,
  parentCategoryId: string | null,
) {
  const existing = await prisma.itemCategory.findFirst({
    where: { tenantId, name, parentCategoryId },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.itemCategory.create({
    data: {
      tenantId,
      name,
      parentCategoryId,
      isGlobal: parentCategoryId === null,
    },
    select: { id: true },
  });
}

async function getOrCreateCategoryPath(tenantId: string, sheetName: string) {
  const base = getSheetBaseName(sheetName);
  const familyName =
    base === 'CAFETERIA'
      ? 'SERVICIOS_GENERALES'
      : extractFamilyFromSheetName(sheetName);
  const subcategoryName =
    base === 'CAFETERIA'
      ? 'CAFETERIA'
      : base === 'OFICINA'
        ? 'OFICINA'
        : base || DEFAULT_SUBCATEGORY_NAME;
  const family = await findOrCreateCategory(tenantId, familyName, null);
  const subcategory = await findOrCreateCategory(
    tenantId,
    formatSubcategoryName(subcategoryName),
    family.id,
  );
  return { familyId: family.id, subcategoryId: subcategory.id };
}

/** Importación aditiva: Excel “Insumos de mantención” (3 hojas), contrato Caserones ~395. */
const INSUMOS_FAMILY = 'INSUMOS_MANTENCION';

function classifyInsumosSheet(
  sheetName: string,
): 'PERSONAL' | 'JAULAS' | 'PANOL' | null {
  const k = normalizeSheetKey(sheetName);
  if (k.includes('INVENTARIO') && k.includes('PERSONAL')) return 'PERSONAL';
  if (k === 'JAULAS') return 'JAULAS';
  if (k === 'PANOL' || k === 'PAÑOL') return 'PANOL';
  return null;
}

function workbookLooksLikeInsumosMantencion(sheetNames: string[]): boolean {
  const kinds = sheetNames
    .map((s) => classifyInsumosSheet(s))
    .filter((x): x is 'PERSONAL' | 'JAULAS' | 'PANOL' => x != null);
  const set = new Set(kinds);
  return set.has('PERSONAL') && set.has('JAULAS') && set.has('PANOL');
}

function parseContractDigits395_448(raw: unknown): '395' | '448' {
  const s = normalizeText(raw);
  if (/\b448\b/.test(s)) return '448';
  if (/\b395\b/.test(s)) return '395';
  return '395';
}

/** Toma el primer número de una celda tipo "654 LITROS", "3 UNIDADES", "2 RH/LH". */
function parseInsumosQuantityLeadingNumber(value: unknown): number {
  const s = normalizeText(value);
  if (!s) return 0;
  const m = s.match(/-?[\d]+([.,]\d+)?/);
  if (!m) return 0;
  const n = parseNumber(m[0]);
  return n != null && n >= 0 ? n : 0;
}

function inferUomFromCantidadCell(value: unknown): {
  abbreviation: string;
  name: string;
} {
  const s = normalizeKey(normalizeText(value));
  if (s.includes('LITRO') || s.includes('LTS') || s === 'LT')
    return { abbreviation: 'LT', name: 'Litro' };
  if (s.includes('KILO') || s.includes('KG'))
    return { abbreviation: 'KG', name: 'Kilogramo' };
  if (s.includes('UNIDAD') || s.includes('UND'))
    return { abbreviation: 'UN', name: 'Unidad' };
  return { abbreviation: 'UN', name: 'Unidad' };
}

function slugWarehouseSegment(text: string, maxLen: number): string {
  const slug = normalizeKey(text)
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'GEN';
  return slug.slice(0, maxLen);
}

async function getOrCreateContractByCode(
  tenantId: string,
  code: '395' | '448',
): Promise<{ id: string; code: string }> {
  const found = await prisma.contract.findFirst({
    where: {
      tenantId,
      OR: [{ code }, { code: { startsWith: code } }],
    },
    select: { id: true, code: true },
  });
  if (found) return found;
  return prisma.contract.create({
    data: {
      tenantId,
      code,
      name: `Contrato ${code}`,
      isActive: true,
    },
    select: { id: true, code: true },
  });
}

async function getOrCreateInsumosWarehouse(
  tenantId: string,
  contractId: string,
  code: string,
  name: string,
) {
  const safeCode = code.slice(0, 50);
  const safeName = name.slice(0, 100);
  return prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId, code: safeCode } },
    update: { name: safeName, contractId, isActive: true },
    create: {
      tenantId,
      contractId,
      code: safeCode,
      name: safeName,
      type: 'PHYSICAL',
      isActive: true,
    },
  });
}

async function getOrCreateInsumosCategoryPath(
  tenantId: string,
  subKey: 'INVENTARIO_PERSONAL' | 'JAULAS' | 'PAÑOL',
) {
  const labels: Record<typeof subKey, string> = {
    INVENTARIO_PERSONAL: 'Inventario personal',
    JAULAS: 'Jaulas',
    PAÑOL: 'Pañol',
  };
  const family = await findOrCreateCategory(tenantId, INSUMOS_FAMILY, null);
  const sub = await findOrCreateCategory(tenantId, labels[subKey], family.id);
  return { familyId: family.id, subcategoryId: sub.id };
}

function isGenericPartToken(raw: string): boolean {
  const k = normalizeKey(raw);
  return (
    !k ||
    k === 'S/N' ||
    k === 'SN' ||
    k === 'NA' ||
    k === 'N/A' ||
    k === 'SINPARTE'
  );
}

function normalizeInsumosPartNumber(
  rawPart: string,
  prefix: 'INS' | 'JAU' | 'PAN',
  name: string,
  description: string,
): string {
  let p = normalizeText(rawPart).replace(/\s+/g, ' ').trim();
  if (p.length > 50) p = p.slice(0, 50);
  if (isGenericPartToken(p) || !p) {
    return buildCatalogPartNumber(prefix, name, description || 'GEN');
  }
  return p.slice(0, 50);
}

async function resolveUom(
  tenantId: string,
  abbreviation: string,
  displayName: string,
) {
  const abbr = abbreviation.slice(0, 20);
  return prisma.unitOfMeasure.upsert({
    where: { tenantId_abbreviation: { tenantId, abbreviation: abbr } },
    update: { name: displayName.slice(0, 80) },
    create: {
      tenantId,
      name: displayName.slice(0, 80),
      abbreviation: abbr,
    },
    select: { id: true },
  });
}

export async function importInsumosMantencionFromExcel(
  filePath: string,
  tenantId: string,
): Promise<void> {
  const workbook = XLSX.readFile(resolve(filePath));
  if (!workbookLooksLikeInsumosMantencion(workbook.SheetNames)) {
    throw new Error(
      'El archivo no coincide con el formato Insumos Mantención (3 hojas: Inventario personal, JAULAS, PAÑOL).',
    );
  }

  const userId = await resolveUserId(tenantId);
  const defaultUom = await prisma.unitOfMeasure.upsert({
    where: { tenantId_abbreviation: { tenantId, abbreviation: 'UN' } },
    update: { name: 'Unidad' },
    create: { tenantId, name: 'Unidad', abbreviation: 'UN' },
    select: { id: true },
  });

  let uniqueItemsCreated = 0;
  let stockRecordsCreated = 0;
  const zeroPriceItems = new Set<string>();

  async function ensureItem(
    partNumber: string,
    name: string,
    description: string | null,
    brand: string | null,
    categoryId: string,
    uomId: string,
    inventoryCode: string | null,
  ): Promise<string> {
    if (inventoryCode) {
      const bySku = await prisma.inventoryItem.findFirst({
        where: { tenantId, inventoryCode },
        select: { id: true },
      });
      if (bySku) return bySku.id;
    }
    const existing = await prisma.inventoryItem.findFirst({
      where: { tenantId, partNumber },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await prisma.inventoryItem.create({
      data: {
        id: randomUUID(),
        tenantId,
        qrCode: `INV:${randomUUID()}`,
        inventoryCode,
        partNumber,
        name: name.slice(0, 150),
        description: description?.trim() || null,
        brand: brand ? brand.slice(0, 50) : null,
        categoryId,
        unitOfMeasureId: uomId,
        isConsumable: true,
        isInventory: true,
        isAsset: false,
      },
      select: { id: true },
    });
    uniqueItemsCreated += 1;
    return created.id;
  }

  async function recordLine(opts: {
    warehouseId: string;
    sheetLabel: string;
    partNumber: string;
    name: string;
    description: string | null;
    brand: string | null;
    categoryId: string;
    uomId: string;
    quantity: number;
    unitCost: Prisma.Decimal;
    inventoryCode?: string | null;
    location?: string | null;
    detailNote: string;
  }) {
    const itemId = await ensureItem(
      opts.partNumber,
      opts.name,
      opts.description,
      opts.brand,
      opts.categoryId,
      opts.uomId,
      opts.inventoryCode ?? null,
    );

    const prev = await prisma.itemStock.findUnique({
      where: {
        warehouseId_itemId: { warehouseId: opts.warehouseId, itemId },
      },
      select: { quantity: true },
    });
    const previousQty = prev?.quantity ?? 0;
    const newQty = opts.quantity;
    const totalVal = new Prisma.Decimal(newQty)
      .mul(opts.unitCost)
      .toDecimalPlaces(2);

    await prisma.itemStock.upsert({
      where: {
        warehouseId_itemId: { warehouseId: opts.warehouseId, itemId },
      },
      update: {
        quantity: newQty,
        unitCost: opts.unitCost,
        location: opts.location?.slice(0, 120) ?? null,
      },
      create: {
        warehouseId: opts.warehouseId,
        itemId,
        quantity: newQty,
        unitCost: opts.unitCost,
        location: opts.location?.slice(0, 120) ?? null,
      },
    });
    if (!prev) stockRecordsCreated += 1;

    await prisma.inventoryTransaction.create({
      data: {
        warehouseId: opts.warehouseId,
        itemId,
        userId,
        type: TransactionType.ADJUST,
        quantity: newQty - previousQty,
        previousStock: previousQty,
        newStock: newQty,
        notes: `Migración Insumos Mantención — ${opts.sheetLabel} | ${opts.detailNote} | ValorTotal=${totalVal.toFixed(2)} (Cant=${newQty} × CPP=${opts.unitCost.toFixed(2)})`,
      },
    });
  }

  for (const sheetName of workbook.SheetNames) {
    const kind = classifyInsumosSheet(sheetName);
    if (!kind) {
      console.warn(`[INSUMOS: omitida] ${sheetName}`);
      continue;
    }
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    let rows: RawRow[];
    try {
      rows = buildRowsFromDiscoveredHeader(matrix);
    } catch (e) {
      console.warn(
        `[INSUMOS: sin encabezado] ${sheetName}: ${e instanceof Error ? e.message : '?'}`,
      );
      continue;
    }
    if (rows.length === 0) continue;

    const sample = rows[0];
    const itemKey = getColumnKey(sample, HEADER_CANDIDATES.item);
    const partKey = getColumnKey(sample, HEADER_CANDIDATES.partNumber);
    const stockKey = getColumnKey(sample, HEADER_CANDIDATES.stock);
    const descExtraKey = getColumnKey(sample, HEADER_CANDIDATES.description);
    const brandKey = getColumnKey(sample, HEADER_CANDIDATES.brand);
    const sectorKey = getColumnKey(sample, HEADER_CANDIDATES.sector);
    const contractKey = getColumnKey(sample, HEADER_CANDIDATES.contract);
    const unitCostKey = getColumnKey(sample, HEADER_CANDIDATES.unitCost);
    const invCodeKey = getColumnKey(sample, HEADER_CANDIDATES.inventoryCode);
    const stockLocKey = getColumnKey(sample, HEADER_CANDIDATES.stockLocation);

    if (!itemKey || !stockKey) {
      console.warn(
        `[INSUMOS: columnas] ${sheetName}: faltan nombre o cantidad.`,
      );
      continue;
    }

    if (kind === 'PERSONAL') {
      const cat = await getOrCreateInsumosCategoryPath(
        tenantId,
        'INVENTARIO_PERSONAL',
      );
      const contract = await getOrCreateContractByCode(tenantId, '395');

      for (const row of rows) {
        const name = normalizeText(row[itemKey]);
        if (!name) continue;
        const brand = brandKey ? normalizeText(row[brandKey]) : '';
        const rawPart = partKey ? normalizeText(row[partKey]) : '';
        const rawInvCode = invCodeKey ? normalizeText(row[invCodeKey]) : '';
        const inventoryCodeExcel = rawInvCode
          ? normalizeInventoryCode(rawInvCode).slice(0, 60)
          : null;
        const sectorRaw = sectorKey ? normalizeText(row[sectorKey]) : '';
        const sector = sectorRaw || 'SIN UBICACIÓN';
        const whCode = `BOD-IM-${slugWarehouseSegment(sector, 36)}`.slice(
          0,
          50,
        );
        const whName = `Mant. Caserones — ${sector}`.slice(0, 100);
        const warehouse = await getOrCreateInsumosWarehouse(
          tenantId,
          contract.id,
          whCode,
          whName,
        );

        const qty = parseInsumosQuantityLeadingNumber(row[stockKey]);
        const partNumber = normalizeInsumosPartNumber(
          rawPart,
          'INS',
          name,
          brand,
        );
        const descParts = [brand ? `Marca/Modelo: ${brand}` : ''].filter(
          Boolean,
        );
        const description = descParts.join(' | ') || null;

        const unitCost = new Prisma.Decimal(0).toDecimalPlaces(2);

        const binLoc =
          (stockLocKey ? normalizeText(row[stockLocKey]) : '') || sectorRaw;

        await recordLine({
          warehouseId: warehouse.id,
          sheetLabel: sheetName,
          partNumber,
          name,
          description,
          brand: brand || null,
          categoryId: cat.subcategoryId,
          uomId: defaultUom.id,
          quantity: qty,
          unitCost,
          inventoryCode: inventoryCodeExcel,
          location: binLoc ? binLoc.slice(0, 120) : null,
          detailNote: `Sector=${sector}`,
        });
      }
    } else if (kind === 'JAULAS') {
      const cat = await getOrCreateInsumosCategoryPath(tenantId, 'JAULAS');

      for (const row of rows) {
        const name = normalizeText(row[itemKey]);
        if (!name) continue;
        const tipo = descExtraKey ? normalizeText(row[descExtraKey]) : '';
        const contractCode = contractKey
          ? parseContractDigits395_448(row[contractKey])
          : '395';
        const contract = await getOrCreateContractByCode(
          tenantId,
          contractCode,
        );
        const whCode = `BOD-IM-JAULAS-${contractCode}`.slice(0, 50);
        const whName = `Bodega Jaulas (${contractCode})`.slice(0, 100);
        const warehouse = await getOrCreateInsumosWarehouse(
          tenantId,
          contract.id,
          whCode,
          whName,
        );

        const rawQty = row[stockKey];
        const qty = parseInsumosQuantityLeadingNumber(rawQty);
        const { abbreviation, name: uomName } =
          inferUomFromCantidadCell(rawQty);
        const uom = await resolveUom(tenantId, abbreviation, uomName);

        const obsKey = Object.keys(row).find((k) =>
          normalizeKey(k).includes('OBSV'),
        );
        const obs = obsKey ? normalizeText(row[obsKey]) : '';
        const description =
          [tipo ? `Tipo: ${tipo}` : '', obs ? `Obs: ${obs}` : '']
            .filter(Boolean)
            .join(' | ') || null;

        const partNumber = normalizeInsumosPartNumber(
          '',
          'JAU',
          name,
          tipo || obs || 'GEN',
        );

        const rawInvCode = invCodeKey ? normalizeText(row[invCodeKey]) : '';
        const inventoryCodeExcel = rawInvCode
          ? normalizeInventoryCode(rawInvCode).slice(0, 60)
          : null;
        const locRaw = stockLocKey ? normalizeText(row[stockLocKey]) : '';

        const unitCost = new Prisma.Decimal(0).toDecimalPlaces(2);

        await recordLine({
          warehouseId: warehouse.id,
          sheetLabel: sheetName,
          partNumber,
          name,
          description,
          brand: null,
          categoryId: cat.subcategoryId,
          uomId: uom.id,
          quantity: qty,
          unitCost,
          inventoryCode: inventoryCodeExcel,
          location: locRaw ? locRaw.slice(0, 120) : null,
          detailNote: `Contrato=${contractCode}`,
        });
      }
    } else if (kind === 'PANOL') {
      const cat = await getOrCreateInsumosCategoryPath(tenantId, 'PAÑOL');
      const contract = await getOrCreateContractByCode(tenantId, '395');
      const whCode = 'BOD-IM-PANOL-395'.slice(0, 50);
      const whName = 'Bodega Pañol mantención (395)'.slice(0, 100);
      const warehouse = await getOrCreateInsumosWarehouse(
        tenantId,
        contract.id,
        whCode,
        whName,
      );

      const descKey = getColumnKey(sample, HEADER_CANDIDATES.description);
      const obsKey = Object.keys(sample).find((k) =>
        normalizeKey(k).includes('OBSV'),
      );

      for (const row of rows) {
        const name = normalizeText(row[itemKey]);
        if (!name) continue;
        const desc = descKey ? normalizeText(row[descKey]) : '';
        const rawPart = partKey ? normalizeText(row[partKey]) : '';
        const obs = obsKey ? normalizeText(row[obsKey]) : '';
        const description =
          [desc ? `Desc: ${desc}` : '', obs ? `Obs: ${obs}` : '']
            .filter(Boolean)
            .join(' | ') || null;

        const qty = parseInsumosQuantityLeadingNumber(row[stockKey]);
        const partNumber = normalizeInsumosPartNumber(
          rawPart,
          'PAN',
          name,
          desc || obs || 'GEN',
        );

        const rawInvCode = invCodeKey ? normalizeText(row[invCodeKey]) : '';
        const inventoryCodeExcel = rawInvCode
          ? normalizeInventoryCode(rawInvCode).slice(0, 60)
          : null;
        const locRaw = stockLocKey ? normalizeText(row[stockLocKey]) : '';

        const rawPrice = unitCostKey ? row[unitCostKey] : null;
        const parsed = parseNumber(rawPrice);
        const unitCostNumber = parsed != null && parsed >= 0 ? parsed : 0;
        if (parsed == null || isMissingUnitPrice(rawPrice)) {
          zeroPriceItems.add(`${partNumber} - ${name}`);
        }
        const unitCost = new Prisma.Decimal(unitCostNumber).toDecimalPlaces(2);

        await recordLine({
          warehouseId: warehouse.id,
          sheetLabel: sheetName,
          partNumber,
          name,
          description,
          brand: null,
          categoryId: cat.subcategoryId,
          uomId: defaultUom.id,
          quantity: qty,
          unitCost,
          inventoryCode: inventoryCodeExcel,
          location: locRaw ? locRaw.slice(0, 120) : null,
          detailNote: 'Pañol herramientas',
        });
      }
    }
  }

  console.log('📊 Resumen importación INSUMOS MANTENCIÓN');
  console.log(`- Ítems nuevos creados: ${uniqueItemsCreated}`);
  console.log(`- Registros de stock nuevos: ${stockRecordsCreated}`);
  if (zeroPriceItems.size > 0) {
    console.log('- Revisar precio $0 o sin valor (Jaulas / Pañol):');
    for (const line of zeroPriceItems) console.log(`  • ${line}`);
  }
  console.log(
    '- Nota: hoja “Inventario personal” no trae CPP en el Excel; quedó en 0.',
  );
}

export async function resetDatabase(tenantId: string): Promise<void> {
  const safeTenantId = tenantId?.trim();
  if (!safeTenantId || !UUID_REGEX.test(safeTenantId)) {
    throw new Error(
      'CRITICO: resetDatabase abortado. tenantId vacío o inválido (UUID requerido).',
    );
  }

  await prisma.$transaction(async (tx) => {
    const contracts = await tx.contract.findMany({
      where: {
        tenantId: safeTenantId,
        code: { notIn: [...PRESERVED_CONTRACT_CODES] },
      },
      select: { id: true },
    });
    const candidateContractIds = contracts.map((c) => c.id);
    const referencedContractIds = new Set<string>();
    const reqRefs = await tx.purchaseRequisition.findMany({
      where: { contractId: { in: candidateContractIds } },
      select: { contractId: true },
    });
    for (const row of reqRefs) {
      referencedContractIds.add(row.contractId);
    }
    const poRefs = await tx.purchaseOrder.findMany({
      where: { contractId: { in: candidateContractIds } },
      select: { contractId: true },
    });
    for (const row of poRefs) {
      referencedContractIds.add(row.contractId);
    }
    const contractIds = candidateContractIds.filter(
      (id) => !referencedContractIds.has(id),
    );

    await tx.inventoryTransaction.deleteMany({
      where: { warehouse: { tenantId: safeTenantId } },
    });
    await tx.itemStock.deleteMany({
      where: { warehouse: { tenantId: safeTenantId } },
    });
    await tx.inventoryTransferLine.deleteMany({
      where: { transfer: { tenantId: safeTenantId } },
    });
    await tx.inventoryTransfer.deleteMany({
      where: { tenantId: safeTenantId },
    });
    await tx.stockReservation.deleteMany({
      where: { warehouse: { tenantId: safeTenantId } },
    });
    await tx.inventoryItemAttachment.deleteMany({
      where: { tenantId: safeTenantId },
    });
    await tx.inventoryItem.deleteMany({ where: { tenantId: safeTenantId } });
    await tx.receiptItem.deleteMany({
      where: { receipt: { tenantId: safeTenantId } },
    });
    await tx.warehouseReceipt.deleteMany({ where: { tenantId: safeTenantId } });
    await tx.warehouseBin.deleteMany({
      where: { warehouse: { tenantId: safeTenantId } },
    });
    await tx.warehouse.deleteMany({ where: { tenantId: safeTenantId } });
    await tx.unitOfMeasure.deleteMany({
      where: {
        tenantId: safeTenantId,
        OR: [
          { name: { contains: '$' } },
          { abbreviation: { contains: '$' } },
          { AND: [{ name: { contains: ',' } }, { name: { contains: '.' } }] },
          {
            AND: [
              { abbreviation: { contains: ',' } },
              { abbreviation: { contains: '.' } },
            ],
          },
        ],
      },
    });
    await tx.itemCategory.deleteMany({ where: { tenantId: safeTenantId } });

    if (contractIds.length > 0) {
      await tx.userContract.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await tx.maintenanceKit.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await tx.equipment.updateMany({
        where: { contractId: { in: contractIds } },
        data: { contractId: null },
      });
      const subcontractIds = (
        await tx.subcontract.findMany({
          where: { contractId: { in: contractIds } },
          select: { id: true },
        })
      ).map((s) => s.id);
      await tx.equipment.updateMany({
        where: { subcontractId: { in: subcontractIds } },
        data: { subcontractId: null },
      });
      await tx.purchaseRequisition.updateMany({
        where: { subcontractId: { in: subcontractIds } },
        data: { subcontractId: null },
      });
      await tx.purchaseOrder.updateMany({
        where: { subcontractId: { in: subcontractIds } },
        data: { subcontractId: null },
      });
      await tx.subcontract.deleteMany({
        where: { id: { in: subcontractIds } },
      });
      await tx.contract.deleteMany({ where: { id: { in: contractIds } } });
    }
  });
}

export async function importFromExcel(
  filePath: string,
  tenantId: string,
): Promise<void> {
  const workbook = XLSX.readFile(resolve(filePath));
  const userId = await resolveUserId(tenantId);

  const defaultUom = await prisma.unitOfMeasure.upsert({
    where: { tenantId_abbreviation: { tenantId, abbreviation: 'UN' } },
    update: { name: 'Unidad' },
    create: { tenantId, name: 'Unidad', abbreviation: 'UN' },
    select: { id: true },
  });

  const itemCache = new Map<string, string>();
  const generatedPartByKey = new Map<string, string>();
  const zeroPriceItems = new Set<string>();
  let generatedPartSequence = 0;
  let uniqueItemsCreated = 0;
  let stockRecordsCreated = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    let rows: RawRow[];
    try {
      rows = buildRowsFromDiscoveredHeader(matrix);
    } catch (error) {
      console.warn(
        `[HOJA OMITIDA] ${sheetName}: ${error instanceof Error ? error.message : 'Sin encabezado'}`,
      );
      continue;
    }
    if (rows.length === 0) continue;

    const warehouse = await getOrCreateWarehouse(tenantId, sheetName);
    const categoryPath = await getOrCreateCategoryPath(tenantId, sheetName);
    const cafeteriaSheet = isCafeteriaSheet(sheetName);
    const officeSheet = isOfficeSheet(sheetName);
    const eppSheet = isEppSheet(sheetName);
    const ropaSheet = isRopaInviernoSheet(sheetName);

    const firstRow = rows[0];
    const partNumberKey = getColumnKey(firstRow, HEADER_CANDIDATES.partNumber);
    const itemKey = getColumnKey(firstRow, HEADER_CANDIDATES.item);
    const stockKey = getColumnKey(firstRow, HEADER_CANDIDATES.stock);
    const minStockKey = getColumnKey(firstRow, HEADER_CANDIDATES.minStock);
    const unitCostKey = getColumnKey(firstRow, HEADER_CANDIDATES.unitCost);
    const categoryKey = getColumnKey(firstRow, HEADER_CANDIDATES.category);
    const descriptionKey = getColumnKey(
      firstRow,
      HEADER_CANDIDATES.description,
    );
    const uomKey = getColumnKey(firstRow, HEADER_CANDIDATES.uom);

    for (const row of rows) {
      const itemData = extractPartAndName(row, partNumberKey, itemKey);
      if (!itemData) continue;
      const rawPartNumber = itemData.partNumber;
      const itemDescription = normalizeText(
        descriptionKey ? row[descriptionKey] : '',
      );

      if (cafeteriaSheet) {
        if (shouldSkipCodeLikeRow(itemData.name, itemDescription)) continue;
        itemData.partNumber = buildCatalogPartNumber(
          'CAF',
          itemData.name,
          itemDescription,
        );
      }
      if (officeSheet) {
        if (
          shouldSkipOfficeRow(
            sheetName,
            rawPartNumber,
            itemData.name,
            itemDescription,
          )
        )
          continue;
        itemData.partNumber = buildCatalogPartNumber(
          'OFF',
          itemData.name,
          itemDescription,
        );
      }
      if (eppSheet) {
        if (shouldSkipEppRow(itemData.name, itemDescription)) continue;
        itemData.partNumber = buildCatalogPartNumber(
          'EPP',
          itemData.name,
          itemDescription,
        );
      }
      if (ropaSheet) {
        if (shouldSkipRopaRow(itemData.name, itemDescription)) continue;
        itemData.partNumber = buildCatalogPartNumber(
          'ROP',
          itemData.name,
          itemDescription,
        );
      }

      if (!itemData.partNumber) {
        const key = normalizeKey(`${itemData.name}|${itemDescription}`);
        if (!generatedPartByKey.has(key)) {
          generatedPartSequence += 1;
          generatedPartByKey.set(
            key,
            `XLS-${String(generatedPartSequence).padStart(6, '0')}`,
          );
        }
        itemData.partNumber = generatedPartByKey.get(key)!;
      }

      const quantity = parseQuantity(stockKey ? row[stockKey] : null);
      const minStock = parseQuantity(minStockKey ? row[minStockKey] : null);
      const unitPriceRaw = unitCostKey ? row[unitCostKey] : null;
      const parsedUnitCost = parseNumber(unitPriceRaw);
      const unitCostNumber =
        parsedUnitCost != null && parsedUnitCost >= 0 ? parsedUnitCost : 0;
      if (parsedUnitCost == null || isMissingUnitPrice(unitPriceRaw)) {
        zeroPriceItems.add(`${itemData.partNumber} - ${itemData.name}`);
        console.warn(
          `[REVISAR PRECIO] Hoja=${sheetName} Item=${itemData.partNumber} (${itemData.name}) Precio="${normalizeText(unitPriceRaw)}" => 0`,
        );
      }
      const unitCost = new Prisma.Decimal(unitCostNumber).toDecimalPlaces(2);

      const rawUom = normalizeText(uomKey ? row[uomKey] : '');
      const looksLikePriceUom =
        !!rawUom && (rawUom.includes('$') || parseNumber(rawUom) != null);
      const uomAbbreviation =
        !rawUom || looksLikePriceUom ? 'UN' : normalizeKey(rawUom).slice(0, 20);
      const resolvedUom =
        uomAbbreviation === 'UN'
          ? defaultUom
          : await prisma.unitOfMeasure.upsert({
              where: {
                tenantId_abbreviation: {
                  tenantId,
                  abbreviation: uomAbbreviation,
                },
              },
              update: { name: rawUom },
              create: { tenantId, name: rawUom, abbreviation: uomAbbreviation },
              select: { id: true },
            });

      const rowCategoryName = normalizeText(
        categoryKey ? row[categoryKey] : '',
      );
      const mergeKey =
        cafeteriaSheet || officeSheet || eppSheet || ropaSheet
          ? normalizeKey(`${itemData.name}|${itemDescription}`)
          : normalizeKey(`${itemData.partNumber}|${itemData.name}`);

      let itemId = itemCache.get(mergeKey);
      if (!itemId) {
        const existing =
          cafeteriaSheet || officeSheet || eppSheet || ropaSheet
            ? await prisma.inventoryItem.findFirst({
                where: {
                  tenantId,
                  name: itemData.name,
                  description: itemDescription || null,
                },
                select: { id: true },
              })
            : await prisma.inventoryItem.findFirst({
                where: {
                  tenantId,
                  OR: [
                    { partNumber: itemData.partNumber },
                    { name: itemData.name },
                  ],
                },
                select: { id: true },
              });

        if (existing) {
          itemId = existing.id;
        } else {
          const categoryForItem = rowCategoryName
            ? await prisma.itemCategory.findFirst({
                where: {
                  tenantId,
                  parentCategoryId: categoryPath.familyId,
                  name: rowCategoryName,
                },
                select: { id: true },
              })
            : null;
          const created = await prisma.inventoryItem.create({
            data: {
              id: randomUUID(),
              tenantId,
              qrCode: `INV:${randomUUID()}`,
              partNumber: itemData.partNumber,
              name: itemData.name,
              description: itemDescription || null,
              categoryId: categoryForItem?.id ?? categoryPath.subcategoryId,
              unitOfMeasureId: resolvedUom.id,
              isConsumable: true,
              isInventory: true,
              isAsset: false,
            },
            select: { id: true },
          });
          itemId = created.id;
          uniqueItemsCreated += 1;
        }
        itemCache.set(mergeKey, itemId);
      }

      const previousStockRecord = await prisma.itemStock.findUnique({
        where: { warehouseId_itemId: { warehouseId: warehouse.id, itemId } },
        select: { quantity: true },
      });
      const previousStock = previousStockRecord?.quantity ?? 0;
      const newStock = quantity;
      const initialTotalValue = new Prisma.Decimal(newStock)
        .mul(unitCost)
        .toDecimalPlaces(2);

      await prisma.itemStock.upsert({
        where: { warehouseId_itemId: { warehouseId: warehouse.id, itemId } },
        update: { quantity: newStock, minStock, unitCost },
        create: {
          warehouseId: warehouse.id,
          itemId,
          quantity: newStock,
          minStock,
          unitCost,
        },
      });
      if (!previousStockRecord) stockRecordsCreated += 1;

      await prisma.inventoryTransaction.create({
        data: {
          warehouseId: warehouse.id,
          itemId,
          userId,
          type: TransactionType.ADJUST,
          quantity: newStock - previousStock,
          previousStock,
          newStock,
          notes: `Migración Inicial Excel - Hoja ${sheetName} | ValorTotal=${initialTotalValue.toFixed(2)} (Cantidad=${newStock} x PrecioUnitario=${unitCost.toFixed(2)})`,
        },
      });
    }
  }

  console.log('📊 Resumen de importación');
  console.log(`- Ítems únicos creados: ${uniqueItemsCreated}`);
  console.log(`- Registros de stock creados: ${stockRecordsCreated}`);
  if (zeroPriceItems.size > 0) {
    console.log('- Ítems con precio $0 (revisión manual):');
    for (const item of zeroPriceItems) console.log(`  • ${item}`);
  } else {
    console.log('- Ítems con precio $0: ninguno');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Importador específico para el formato "Consolidado de Inventario BaseLogic"
// Hoja única: "Lista de inventario" — encabezados en fila 6, datos desde fila 7.
// ─────────────────────────────────────────────────────────────────────────────
export async function importConsolidadoFromExcel(
  filePath: string,
  tenantId: string,
): Promise<void> {
  const workbook = XLSX.readFile(resolve(filePath));

  const sheetName = workbook.SheetNames.find((s) =>
    normalizeSheetKey(s).includes('LISTA') ||
    normalizeSheetKey(s).includes('INVENTARIO') ||
    normalizeSheetKey(s).includes('CONSOLIDADO'),
  ) ?? workbook.SheetNames[0];

  if (!sheetName) throw new Error('No se encontró hoja de inventario en el archivo.');

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Hoja "${sheetName}" vacía.`);

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  /**
   * Detector de encabezados específico para el formato Consolidado BaseLogic.
   * Busca la primera fila que contenga celdas con COINCIDENCIA EXACTA a los
   * headers conocidos: "BODEGA", "MARCA", "PRECIO POR UNIDAD", etc.
   * Esto diferencia la fila real de headers (ROW6 con "Bodega") de la fila
   * de descripciones (ROW5 con "Cantidad de articulos en bodega, puede ser...").
   */
  function buildRowsConsolidado(mx: SheetMatrix): RawRow[] {
    // Requiere coincidencia EXACTA (igualdad) con al menos 2 de estos marcadores.
    const EXACT_MARKERS = ['BODEGA', 'MARCA', 'SUBDIVISION', 'PROVEEDOR'];
    let headerIdx = -1;

    for (let i = 0; i < Math.min(20, mx.length); i++) {
      const cells = (mx[i] ?? []).map((c) => normalizeKey(c));
      const exactMatches = EXACT_MARKERS.filter((marker) =>
        cells.some((c) => c === marker),
      );
      if (exactMatches.length >= 2) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx < 0) {
      // fallback al detector genérico
      return buildRowsFromDiscoveredHeader(mx);
    }

    const headerRow = mx[headerIdx] ?? [];
    const builtRows: RawRow[] = [];
    for (let i = headerIdx + 1; i < mx.length; i++) {
      const dataRow = mx[i] ?? [];
      if (dataRow.every((cell) => normalizeText(cell) === '')) continue;
      const row: RawRow = {};
      for (let col = 0; col < headerRow.length; col++) {
        const key = normalizeText(headerRow[col]);
        if (!key) continue;
        row[key] = dataRow[col] ?? '';
      }
      if (Object.keys(row).length > 0) builtRows.push(row);
    }
    return builtRows;
  }

  let rows: RawRow[];
  try {
    rows = buildRowsConsolidado(matrix);
  } catch (e) {
    throw new Error(
      `No se detectó fila de encabezados en "${sheetName}": ${e instanceof Error ? e.message : '?'}`,
    );
  }
  if (rows.length === 0) throw new Error('La hoja no tiene filas de datos.');

  const userId = await resolveUserId(tenantId);

  const sample = rows[0];

  /**
   * Busca la clave del row para una columna del Consolidado usando:
   * 1) Igualdad EXACTA (normalizeKey) con alguno de los exactCandidates.
   * 2) Fallback: búsqueda fuzzy con fuzzyCandidates (comportamiento original).
   * Esto evita que columnas como "Artículos marcados que van a volver a pedirse"
   * capturen erróneamente el slot de "Nombre del Articulo" por contener "ARTICULO".
   */
  function resolveConsolidadoKey(
    exactCandidates: string[],
    fuzzyCandidates: readonly string[],
  ): string | null {
    for (const key of Object.keys(sample)) {
      for (const exact of exactCandidates) {
        if (normalizeKey(key) === normalizeKey(exact)) return key;
      }
    }
    return getColumnKey(sample, fuzzyCandidates);
  }

  const itemKey      = resolveConsolidadoKey(
    ['Nombre del Articulo', 'Nombre del Artículo', 'Nombre del Item', 'Nombre Artículo'],
    HEADER_CANDIDATES.item,
  );
  const invCodeKey   = resolveConsolidadoKey(
    ['Identificador de inventario', 'Identificador Inventario'],
    HEADER_CANDIDATES.inventoryCode,
  );
  const partKey      = resolveConsolidadoKey(
    ['Numero de Parte', 'Número de Parte', 'Número Parte'],
    HEADER_CANDIDATES.partNumber,
  );
  const descKey      = resolveConsolidadoKey(
    ['Descripción', 'Descripcion'],
    HEADER_CANDIDATES.description,
  );
  const uomKey       = resolveConsolidadoKey(
    ['Unidad de Medida (UN/KG/LT/MT)', 'Unidad de Medida', 'Unidad Medida'],
    HEADER_CANDIDATES.uom,
  );
  const brandKey     = resolveConsolidadoKey(
    ['Marca'],
    HEADER_CANDIDATES.brand,
  );
  const unitCostKey  = resolveConsolidadoKey(
    ['Precio por unidad', 'Precio Por Unidad'],
    HEADER_CANDIDATES.unitCost,
  );
  const stockKey     = resolveConsolidadoKey(
    ['Cantidad en existencias', 'Cantidad En Existencias'],
    HEADER_CANDIDATES.stock,
  );
  const minStockKey  = resolveConsolidadoKey(
    ['Stock critico', 'Stock crítico', 'Stock Critico'],
    HEADER_CANDIDATES.minStock,
  );
  const sectorKey    = resolveConsolidadoKey(
    ['Bodega'],
    HEADER_CANDIDATES.sector,
  );
  const categoryKey  = resolveConsolidadoKey(
    ['Recursos Operativos'],
    HEADER_CANDIDATES.category,
  );
  const subfamilyKey = resolveConsolidadoKey(
    ['subdivision', 'Subdivision', 'Subdivisión'],
    HEADER_CANDIDATES.subfamily,
  );
  const supplierKey  = resolveConsolidadoKey(
    ['Proveedor'],
    HEADER_CANDIDATES.supplier,
  );
  const stockLocKey  = resolveConsolidadoKey(
    ['Ubicación', 'Ubicacion'],
    HEADER_CANDIDATES.stockLocation,
  );

  if (!itemKey) throw new Error('Columna "Nombre del artículo" no detectada.');

  const uomCache        = new Map<string, string>(); // abbreviation → id
  const categoryCache   = new Map<string, string>(); // "family|sub" → subcategoryId
  const supplierCache   = new Map<string, string>(); // name → id
  const warehouseCache  = new Map<string, string>(); // code → id

  let created = 0;
  let skipped = 0;
  const zeroCost: string[] = [];
  let assignedToFallback = 0;

  async function resolveUomByAbbr(raw: string): Promise<string> {
    const abbr = normalizeKey(raw).slice(0, 20) || 'UN';
    if (uomCache.has(abbr)) return uomCache.get(abbr)!;
    const rec = await prisma.unitOfMeasure.upsert({
      where: { tenantId_abbreviation: { tenantId, abbreviation: abbr } },
      update: {},
      create: { tenantId, name: abbr, abbreviation: abbr },
      select: { id: true },
    });
    uomCache.set(abbr, rec.id);
    return rec.id;
  }

  async function resolveCategoryPath(familyRaw: string, subRaw: string): Promise<string> {
    const familyName = normalizeText(familyRaw).toUpperCase() || 'GENERAL';
    const subName    = normalizeText(subRaw) || 'General';
    const cacheKey   = `${familyName}|${subName}`;
    if (categoryCache.has(cacheKey)) return categoryCache.get(cacheKey)!;

    const family = await findOrCreateCategory(tenantId, familyName, null);
    const sub    = await findOrCreateCategory(tenantId, subName, family.id);
    categoryCache.set(cacheKey, sub.id);
    return sub.id;
  }

  async function resolveSupplierByName(name: string): Promise<string | null> {
    if (!name) return null;
    const trimmed = name.trim().slice(0, 150);
    if (supplierCache.has(trimmed)) return supplierCache.get(trimmed)!;
    const rec = await prisma.inventorySupplier.upsert({
      where: { tenantId_name: { tenantId, name: trimmed } },
      update: {},
      create: { tenantId, name: trimmed },
      select: { id: true },
    });
    supplierCache.set(trimmed, rec.id);
    return rec.id;
  }

  /** Bodega de fallback para ítems sin bodega asignada en el Excel. */
  const FALLBACK_WAREHOUSE_CODE = 'PEND-01';
  let fallbackWarehouseId: string | null = null;
  {
    const fw = await prisma.warehouse.findFirst({
      where: { tenantId, code: FALLBACK_WAREHOUSE_CODE },
      select: { id: true },
    });
    fallbackWarehouseId = fw?.id ?? null;
    if (!fallbackWarehouseId) {
      console.warn(`  ⚠️  Bodega fallback "${FALLBACK_WAREHOUSE_CODE}" no encontrada. Ítems sin bodega no tendrán stock.`);
    }
  }

  async function resolveWarehouseByCode(codeRaw: string): Promise<string | null> {
    const code = normalizeText(codeRaw);
    if (!code) {
      if (fallbackWarehouseId) return fallbackWarehouseId;
      return null;
    }
    if (warehouseCache.has(code)) return warehouseCache.get(code)!;

    // Candidatos de búsqueda: código tal cual + prefijo antes del guión (ej: "448-Cover" → "448")
    const codeParts = [code];
    if (code.includes('-')) codeParts.push(code.split('-')[0].trim());

    let wh: { id: string } | null = null;
    for (const candidate of codeParts) {
      wh = await prisma.warehouse.findFirst({
        where: {
          tenantId,
          OR: [
            { code: candidate },
            { name: { contains: candidate, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (wh) break;
    }

    if (!wh) {
      console.warn(`  ⚠️  Bodega "${code}" no encontrada — se usará fallback PEND-01.`);
      if (fallbackWarehouseId) {
        warehouseCache.set(code, fallbackWarehouseId);
        return fallbackWarehouseId;
      }
      return null;
    }
    warehouseCache.set(code, wh.id);
    return wh.id;
  }

  for (const row of rows) {
    const name = normalizeText(itemKey ? row[itemKey] : '');
    if (!name) { skipped++; continue; }

    const rawInvCode = invCodeKey ? normalizeText(row[invCodeKey]) : '';
    const inventoryCode = rawInvCode ? normalizeInventoryCode(rawInvCode).slice(0, 60) : null;

    const rawPart = partKey ? normalizeText(row[partKey]) : '';
    const partNumber = rawPart && !isGenericPartToken(rawPart)
      ? rawPart.slice(0, 50)
      : null;

    const description = descKey ? normalizeText(row[descKey]) : null;
    const brand       = brandKey ? normalizeText(row[brandKey]) : null;

    const rawUom   = uomKey ? normalizeText(row[uomKey]) : 'UN';
    const uomId    = await resolveUomByAbbr(rawUom);

    const rawFamily  = categoryKey  ? normalizeText(row[categoryKey])  : '';
    const rawSubfam  = subfamilyKey ? normalizeText(row[subfamilyKey]) : '';
    const categoryId = await resolveCategoryPath(rawFamily, rawSubfam);

    const rawSupplier = supplierKey ? normalizeText(row[supplierKey]) : '';
    const supplierId  = await resolveSupplierByName(rawSupplier);

    // Buscar o crear el InventoryItem ─────────────────────────────────────────
    let itemId: string | null = null;

    // 1. Por inventoryCode (identificador principal — si existe y no encuentra, es item nuevo)
    if (inventoryCode) {
      const bySku = await prisma.inventoryItem.findFirst({
        where: { tenantId, inventoryCode },
        select: { id: true },
      });
      if (bySku) itemId = bySku.id;
      // Si tiene invCode y no lo encontró → nuevo item. NO hacer fallback por nombre.
      // Pero si tiene partNumber, verificar que no haya conflicto de unicidad antes del create.
    } else if (partNumber) {
      // 2. Sin invCode pero con partNumber
      const byPn = await prisma.inventoryItem.findFirst({
        where: { tenantId, partNumber },
        select: { id: true },
      });
      if (byPn) itemId = byPn.id;
    } else {
      // 3. Sin invCode ni partNumber → busca por nombre exacto (última opción)
      const byName = await prisma.inventoryItem.findFirst({
        where: { tenantId, name },
        select: { id: true },
      });
      if (byName) itemId = byName.id;
    }

    // Guard: si el item aún no existe pero su partNumber ya está tomado por otro item,
    // consolidar stock en ese item existente (mismo producto, diferente bodega/lote).
    let finalPartNumber = partNumber;
    if (!itemId && finalPartNumber) {
      const conflicting = await prisma.inventoryItem.findFirst({
        where: { tenantId, partNumber: finalPartNumber },
        select: { id: true },
      });
      if (conflicting) {
        // Mismo partNumber → mismo producto. Agregamos stock al item existente.
        console.warn(
          `  ℹ️  PartNumber "${finalPartNumber}" ya existe (otro invCode) → consolidando stock en item existente.`,
        );
        itemId = conflicting.id;
        finalPartNumber = partNumber; // conservar para el item existente
      }
    }

    if (!itemId) {
      const id = randomUUID();
      await prisma.inventoryItem.create({
        data: {
          id,
          tenantId,
          qrCode: `INV:${randomUUID()}`,
          inventoryCode,
          partNumber: finalPartNumber,
          name: name.slice(0, 150),
          description: description?.trim() || null,
          brand: brand ? brand.slice(0, 50) : null,
          categoryId,
          unitOfMeasureId: uomId,
          supplierId,
          isConsumable: true,
          isInventory: true,
          isAsset: false,
          isSerialized: false,
        },
      });
      itemId = id;
      created++;
    }

    // Stock ───────────────────────────────────────────────────────────────────
    const rawWarehouseCode = sectorKey ? normalizeText(row[sectorKey]) : '';
    const warehouseId = await resolveWarehouseByCode(rawWarehouseCode);
    if (warehouseId === fallbackWarehouseId && !rawWarehouseCode) assignedToFallback++;

    if (warehouseId) {
      const qty      = parseQuantity(stockKey ? row[stockKey] : null);
      const minStock = parseQuantity(minStockKey ? row[minStockKey] : null);
      const rawCost  = unitCostKey ? row[unitCostKey] : null;
      const parsedCost = parseNumber(rawCost);
      const costNum    = parsedCost != null && parsedCost >= 0 ? parsedCost : 0;
      if (parsedCost == null || isMissingUnitPrice(rawCost)) {
        zeroCost.push(`${inventoryCode ?? partNumber ?? name}`);
      }
      const unitCost = new Prisma.Decimal(costNum).toDecimalPlaces(2);
      const location = stockLocKey ? normalizeText(row[stockLocKey]) : null;

      const prev = await prisma.itemStock.findUnique({
        where: { warehouseId_itemId: { warehouseId, itemId } },
        select: { quantity: true },
      });
      const prevQty = prev?.quantity ?? 0;

      await prisma.itemStock.upsert({
        where: { warehouseId_itemId: { warehouseId, itemId } },
        update: { quantity: qty, minStock, unitCost, location: location?.slice(0, 120) ?? null },
        create: {
          warehouseId,
          itemId,
          quantity: qty,
          minStock,
          unitCost,
          location: location?.slice(0, 120) ?? null,
        },
      });

      await prisma.inventoryTransaction.create({
        data: {
          warehouseId,
          itemId,
          userId,
          type: TransactionType.ADJUST,
          quantity: qty - prevQty,
          previousStock: prevQty,
          newStock: qty,
          notes: `Importación Consolidado Excel | ${name} | Costo=${unitCost.toFixed(2)}`,
        },
      });
    }
  }

  console.log('\n📊  Resumen importación Consolidado');
  console.log(`  • Artículos nuevos creados : ${created}`);
  console.log(`  • Filas sin nombre (omitidas): ${skipped}`);
  if (assignedToFallback > 0) {
    console.log(`  • Sin bodega → asignados a PEND-01: ${assignedToFallback} (reasignar en sistema)`);
  }
  if (zeroCost.length > 0) {
    console.log(`  • Costo $0 (revisar): ${zeroCost.length}`);
    zeroCost.slice(0, 10).forEach((s) => console.log(`    - ${s}`));
    if (zeroCost.length > 10) console.log(`    … y ${zeroCost.length - 10} más`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.findIndex((arg) => arg === '--file');
  const presetIdx = args.findIndex((arg) => arg === '--preset');
  const preset =
    presetIdx >= 0
      ? normalizeText(args[presetIdx + 1] || '').toLowerCase()
      : '';
  const shouldReset = args.includes('--reset');
  const tenantId = await resolveTenantId();

  if (shouldReset) {
    await resetDatabase(tenantId);
    console.log('✅ Reset finalizado.');
  }

  if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1];
    if (!filePath) throw new Error('Debe indicar --file <ruta-excel>.');

    if (preset === 'consolidado') {
      await importConsolidadoFromExcel(filePath, tenantId);
      console.log('✅ Importación Consolidado completada.');
      return;
    }

    let useInsumos = preset === 'insumos';
    if (!useInsumos && preset !== 'inicial') {
      const peek = XLSX.readFile(resolve(filePath), { sheetRows: 1 });
      useInsumos = workbookLooksLikeInsumosMantencion(peek.SheetNames);
    }
    if (useInsumos) {
      if (shouldReset) {
        console.warn(
          '⚠️ Acaba de ejecutar --reset: solo quedará lo que cargue este Excel. Para tener import_inicial + insumos: primero importe import_inicial.xlsx (con --reset), luego este archivo sin --reset.',
        );
      }
      await importInsumosMantencionFromExcel(filePath, tenantId);
    } else {
      await importFromExcel(filePath, tenantId);
    }
    console.log('✅ Importación completada.');
    return;
  }
  if (!shouldReset) {
    console.log(
      'Uso: ts-node prisma/import-inventory-from-excel.ts --file "<ruta>" [--reset] [--preset consolidado|insumos|inicial]',
    );
    console.log(
      '  --preset consolidado → "Consolidado de Inventario BaseLogic" (hoja única, encabezados fila 6).',
    );
    console.log(
      '  --preset insumos     → INVENTARIO INSUMOS MANTENCION.xlsx (3 hojas).',
    );
    console.log(
      '  --preset inicial     → fuerza el importador multihoja clásico (cafetería/EPP/…).',
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
