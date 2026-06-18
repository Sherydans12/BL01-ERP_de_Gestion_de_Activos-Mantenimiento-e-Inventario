import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';
import { AuditService } from '../../common/audit/audit.service';
import { InventoryItemsService } from './inventory-items.service';
import { generateInventoryMasterExcelBuffer } from './inventory-master-excel.generator';

describe('InventoryItemsService — findItemLedger', () => {
  let service: InventoryItemsService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const itemId = '22222222-2222-2222-2222-222222222222';
  const warehouseId = '33333333-3333-3333-3333-333333333333';
  const woId = '44444444-4444-4444-4444-444444444444';
  const wrId = '55555555-5555-5555-5555-555555555555';
  const trId = '66666666-6666-6666-6666-666666666666';

  const user = { id: '77777777-7777-7777-7777-777777777777', tenantId };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryItemsService);
  });

  function txRow(
    overrides: Partial<{
      type: string;
      referenceType: string | null;
      referenceId: string | null;
    }> = {},
  ) {
    return {
      id: 'tx-row-1',
      date: new Date('2026-05-20T10:00:00.000Z'),
      type: overrides.type ?? 'IN',
      quantity: 5,
      previousStock: 0,
      newStock: 5,
      notes: null,
      isPendingRegularization: false,
      referenceType: overrides.referenceType ?? null,
      referenceId: overrides.referenceId ?? null,
      warehouse: { id: warehouseId, code: 'B-01', name: 'Bodega central' },
      user: { id: user.id, name: 'Operador' },
    };
  }

  it('resuelve artículo por código de inventario', async () => {
    prisma.inventoryItem.findFirst
      .mockResolvedValueOnce({ id: itemId } as never)
      .mockResolvedValueOnce({ id: itemId } as never);
    prisma.inventoryTransaction.findMany.mockResolvedValue([] as never);
    prisma.inventoryTransaction.count.mockResolvedValue(0);
    prisma.activityLog.findFirst.mockResolvedValue(null);

    await service.findItemLedger('IN0042', user, {});

    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, inventoryCode: 'IN0042' },
      }),
    );
  });

  it('rechaza bodega inválida en filtro', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
    prisma.warehouse.findFirst.mockResolvedValue(null);

    await expect(
      service.findItemLedger(itemId, user, { warehouseId: 'bad' }),
    ).rejects.toThrow(/Bodega no válida/);
  });

  it('enriquece referencia WORK_ORDER', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      txRow({
        type: 'WORK_ORDER_ISSUE',
        referenceType: 'WORK_ORDER',
        referenceId: woId,
      }),
    ] as never);
    prisma.inventoryTransaction.count.mockResolvedValue(1);
    prisma.workOrder.findMany.mockResolvedValue([
      { id: woId, correlative: 'OT-2026-010' },
    ] as never);
    prisma.activityLog.findFirst.mockResolvedValue(null);

    const result = await service.findItemLedger(itemId, user, {});

    expect(result.data[0].reference).toEqual(
      expect.objectContaining({
        kind: 'WORK_ORDER',
        label: 'OT OT-2026-010',
        workOrderId: woId,
      }),
    );
  });

  it('marca ADJUST + PURCHASE_RECEIPT como ADJUST_SALDO_PENDIENTE', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      txRow({
        type: 'ADJUST',
        referenceType: 'PURCHASE_RECEIPT',
        referenceId: wrId,
      }),
    ] as never);
    prisma.inventoryTransaction.count.mockResolvedValue(1);
    prisma.warehouseReceipt.findMany.mockResolvedValue([
      {
        id: wrId,
        correlative: 'GR-100',
        purchaseOrderId: 'po-1',
        purchaseOrder: { id: 'po-1', correlative: 'OC-55' },
      },
    ] as never);
    prisma.activityLog.findFirst.mockResolvedValue(null);

    const result = await service.findItemLedger(itemId, user, {});

    expect(result.data[0].reference?.kind).toBe('ADJUST_SALDO_PENDIENTE');
    expect(result.data[0].reference?.label).toContain('Saldo pendiente');
    expect(result.data[0].reference?.label).toContain('OC OC-55');
  });

  it('enriquece TRANSFER_OUT con bodega destino', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      txRow({
        type: 'TRANSFER_OUT',
        referenceType: 'INVENTORY_TRANSFER',
        referenceId: trId,
      }),
    ] as never);
    prisma.inventoryTransaction.count.mockResolvedValue(1);
    prisma.inventoryTransfer.findMany.mockResolvedValue([
      {
        id: trId,
        originWarehouseId: warehouseId,
        destinationWarehouseId: 'dest-wh',
        originWarehouse: { code: 'ORI', name: 'Origen' },
        destinationWarehouse: { code: 'DST', name: 'Destino' },
      },
    ] as never);
    prisma.activityLog.findFirst.mockResolvedValue(null);

    const result = await service.findItemLedger(itemId, user, {});

    expect(result.data[0].reference?.kind).toBe('INVENTORY_TRANSFER');
    expect(result.data[0].reference?.label).toContain('→ DST');
  });

  it('inyecta fila ITEM_GENESIS solo en la última página', async () => {
    const genesisId = '88888888-8888-8888-8888-888888888888';
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
    prisma.inventoryTransaction.findMany.mockResolvedValue([txRow()] as never);
    prisma.inventoryTransaction.count.mockResolvedValue(1);
    prisma.activityLog.findFirst.mockResolvedValue({
      id: genesisId,
      userId: user.id,
      createdAt: new Date('2025-01-01T08:00:00.000Z'),
      user: { id: user.id, name: 'Creador catálogo' },
    } as never);

    const result = await service.findItemLedger(itemId, user, {
      page: 1,
      pageSize: 25,
    });

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[1]).toEqual(
      expect.objectContaining({
        id: genesisId,
        type: 'ITEM_GENESIS',
        notes: 'Alta en catálogo maestro',
        warehouse: expect.objectContaining({ name: 'Catálogo maestro' }),
        reference: null,
      }),
    );
  });

  it('no inyecta génesis si no es la última página', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
    prisma.inventoryTransaction.findMany.mockResolvedValue([txRow()] as never);
    prisma.inventoryTransaction.count.mockResolvedValue(10);
    prisma.activityLog.findFirst.mockResolvedValue({
      id: 'genesis',
      userId: user.id,
      createdAt: new Date(),
      user: { id: user.id, name: 'U' },
    } as never);

    const result = await service.findItemLedger(itemId, user, {
      page: 1,
      pageSize: 5,
    });

    expect(result.total).toBe(11);
    expect(result.data).toHaveLength(1);
    expect(result.data.some((r) => r.type === 'ITEM_GENESIS')).toBe(false);
  });
});

describe('InventoryItemsService — inventario Excel stock-only', () => {
  let service: InventoryItemsService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const itemId = '22222222-2222-2222-2222-222222222222';
  const warehouseId = '33333333-3333-3333-3333-333333333333';
  const contractId = '44444444-4444-4444-4444-444444444444';
  const blockedContractId = '55555555-5555-5555-5555-555555555555';
  const user = {
    id: '77777777-7777-7777-7777-777777777777',
    tenantId,
    role: 'USER',
    allowedContracts: [contractId],
  };

  const headers = [
    'ID articulo',
    'Codigo inventario',
    'Numero parte',
    'Nombre',
    'Descripcion',
    'Familia',
    'Subcategoria',
    'Unidad',
    'Unidad nombre',
    'Permite decimales',
    'Marca',
    'Compatibilidad',
    'Proveedor habitual',
    'Inventariable',
    'Consumible',
    'Activo',
    'Serializado',
    'Bodega codigo',
    'Bodega nombre',
    'Contrato',
    'Subcontrato',
    'Ubicacion stock',
    'Bin codigo',
    'Bin etiqueta',
    'Stock',
    'Stock minimo',
    'Stock maximo',
    'CPP',
    'Valor linea',
    'Bodega politica',
    'Politica minimo',
    'Politica maximo',
    'QR payload',
  ];

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(prisma);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryItemsService);
  });

  function item(overrides: Record<string, unknown> = {}) {
    return {
      id: itemId,
      tenantId,
      inventoryCode: 'IN0001',
      partNumber: 'PN-001',
      name: 'Filtro aceite',
      description: 'Filtro aceite',
      brand: 'ACME',
      compatibilityInfo: 'Motor X',
      isInventory: true,
      isConsumable: true,
      isAsset: false,
      isSerialized: false,
      qrCode: `INV:${itemId}`,
      policyMinStock: 0,
      policyMaxStock: 0,
      itemCategory: {
        name: 'Filtros',
        parentCategory: { name: 'Repuestos' },
      },
      unitOfMeasure: {
        abbreviation: 'UN',
        name: 'Unidad',
        allowsDecimals: false,
      },
      inventorySupplier: { name: 'Proveedor Base' },
      policyTargetWarehouse: null,
      stocks: [
        {
          warehouseId,
          quantity: 5,
          unitCost: new Prisma.Decimal(123),
          minStock: 1,
          maxStock: 10,
          location: 'A-1',
          warehouse: {
            code: 'B01',
            name: 'Bodega 01',
            location: 'Planta',
            contract: { code: 'C-01', name: 'Contrato 01' },
            subcontract: null,
          },
          bin: { code: 'BIN-1', label: 'Bin 1' },
        },
      ],
      ...overrides,
    };
  }

  function warehouse(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: warehouseId,
      tenantId,
      code: 'B01',
      name: 'Bodega 01',
      contractId,
      bins: [{ id: 'bin-1', code: 'BIN-1', label: 'Bin 1' }],
      ...overrides,
    };
  }

  function baseRow(overrides: Record<string, unknown> = {}) {
    return {
      'ID articulo': itemId,
      'Codigo inventario': 'IN0001',
      'Numero parte': 'PN-001',
      Nombre: 'Filtro aceite',
      Descripcion: 'Filtro aceite',
      Familia: 'Repuestos',
      Subcategoria: 'Filtros',
      Unidad: 'UN',
      'Unidad nombre': 'Unidad',
      'Permite decimales': 'NO',
      Marca: 'ACME',
      Compatibilidad: 'Motor X',
      'Proveedor habitual': 'Proveedor Base',
      Inventariable: 'SI',
      Consumible: 'SI',
      Activo: 'NO',
      Serializado: 'NO',
      'Bodega codigo': 'B01',
      'Bodega nombre': 'Bodega 01',
      Contrato: 'C-01',
      Subcontrato: '',
      'Ubicacion stock': 'A-1',
      'Bin codigo': 'BIN-1',
      'Bin etiqueta': 'Bin 1',
      Stock: 5,
      'Stock minimo': 1,
      'Stock maximo': 10,
      CPP: 999,
      'Valor linea': 4995,
      'Bodega politica': '',
      'Politica minimo': 0,
      'Politica maximo': 0,
      'QR payload': `INV:${itemId}`,
      ...overrides,
    };
  }

  async function workbookBuffer(rows: Array<Record<string, unknown>>) {
    const workbook = new ExcelJS.Workbook();
    const dataSheet = workbook.addWorksheet('Inventario');
    dataSheet.addRows([[], [], [], []]);
    dataSheet.addRow(headers);
    for (const row of rows) {
      dataSheet.addRow(headers.map((header) => row[header] ?? null));
    }
    const info = workbook.addWorksheet('_bl_import_contract');
    info.state = 'veryHidden';
    info.addRows([
      ['domain', 'inventory'],
      ['version', '1'],
      ['primarySheet', 'Inventario'],
      ['headerRow', 5],
      ['firstDataRow', 6],
    ]);
    const raw = await workbook.xlsx.writeBuffer();
    return Buffer.from(raw);
  }

  async function validate(rowOverrides: Record<string, unknown> = {}) {
    prisma.inventoryItem.findMany.mockResolvedValueOnce([item()] as never);
    prisma.warehouse.findMany
      .mockResolvedValueOnce([warehouse()] as never)
      .mockResolvedValueOnce([warehouse()] as never);
    return service.validateInventoryMasterImport(
      await workbookBuffer([baseRow(rowOverrides)]),
      user,
    );
  }

  it('exporta columnas esperadas y muestra costos solo con permiso', async () => {
    const bufferWithCost = await generateInventoryMasterExcelBuffer({
      tenantName: 'Tenant',
      generatedAt: new Date('2026-06-18T12:00:00Z'),
      canViewCost: true,
      items: [item()] as never,
      categories: [],
      units: [],
      warehouses: [],
      suppliers: [],
    });
    const wbWithCost = new ExcelJS.Workbook();
    await wbWithCost.xlsx.load(bufferWithCost as never);
    const headersWithCost = wbWithCost
      .getWorksheet('Inventario')!
      .getRow(5)
      .values as unknown[];

    expect(headersWithCost).toContain('CPP');
    expect(headersWithCost).toContain('Valor linea');

    const bufferWithoutCost = await generateInventoryMasterExcelBuffer({
      tenantName: 'Tenant',
      generatedAt: new Date('2026-06-18T12:00:00Z'),
      canViewCost: false,
      items: [item()] as never,
      categories: [],
      units: [],
      warehouses: [],
      suppliers: [],
    });
    const wbWithoutCost = new ExcelJS.Workbook();
    await wbWithoutCost.xlsx.load(bufferWithoutCost as never);
    const headersWithoutCost = wbWithoutCost
      .getWorksheet('Inventario')!
      .getRow(5)
      .values as unknown[];

    expect(headersWithoutCost).toContain('ID articulo');
    expect(headersWithoutCost).toContain('Stock');
    expect(headersWithoutCost).not.toContain('CPP');
    expect(headersWithoutCost).not.toContain('Valor linea');
  });

  it('exporta celdas de datos desbloqueadas bajo la nueva politica operativa', async () => {
    const buffer = await generateInventoryMasterExcelBuffer({
      tenantName: 'Tenant',
      generatedAt: new Date('2026-06-18T12:00:00Z'),
      canViewCost: true,
      items: [item()] as never,
      categories: [],
      units: [],
      warehouses: [],
      suppliers: [],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const dataSheet = workbook.getWorksheet('Inventario')!;
    const row = dataSheet.getRow(6);

    for (let col = 1; col <= dataSheet.getRow(5).cellCount; col += 1) {
      expect(row.getCell(col).protection?.locked).not.toBe(true);
    }
  });

  it('exporta stock y bodegas solo dentro de contratos permitidos para USER', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Tenant' } as never);
    prisma.inventoryItem.findMany.mockResolvedValue([] as never);
    prisma.itemCategory.findMany.mockResolvedValue([] as never);
    prisma.unitOfMeasure.findMany.mockResolvedValue([] as never);
    prisma.warehouse.findMany.mockResolvedValue([] as never);
    prisma.inventorySupplier.findMany.mockResolvedValue([] as never);

    await service.getInventoryMasterExcelBuffer(user);

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          stocks: expect.objectContaining({
            where: {
              warehouse: {
                tenantId,
                contractId: { in: [contractId] },
              },
            },
          }),
        }),
      }),
    );
    expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          contractId: { in: [contractId] },
        },
      }),
    );
  });

  it('rechaza articulos nuevos y cambios estructurales', async () => {
    const result = await validate({
      'ID articulo': '',
      'Codigo inventario': 'IN9999',
      'Numero parte': 'PN-NUEVO',
      Nombre: 'Nuevo por Excel',
    });

    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.previewRows[0].errors.join(' ')).toMatch(
      /solo permite ajustar stock de articulos existentes/i,
    );

    const structural = await validate({ Nombre: 'Nombre editado' });
    expect(structural.summary.errors).toBeGreaterThan(0);
    expect(structural.previewRows[0].errors.join(' ')).toMatch(
      /Cambio estructural no permitido/,
    );
  });

  it('valida bodega existente, alcance por contrato y cantidades', async () => {
    const missingWarehouse = await validate({ 'Bodega codigo': 'NOPE' });
    expect(missingWarehouse.previewRows[0].errors.join(' ')).toMatch(
      /Bodega no existe/,
    );

    prisma.inventoryItem.findMany.mockResolvedValueOnce([item()] as never);
    prisma.warehouse.findMany
      .mockResolvedValueOnce([
        warehouse({ code: 'B02', contractId: blockedContractId }),
      ] as never)
      .mockResolvedValueOnce([] as never);
    const outOfScope = await service.validateInventoryMasterImport(
      await workbookBuffer([baseRow({ 'Bodega codigo': 'B02' })]),
      user,
    );
    expect(outOfScope.previewRows[0].errors.join(' ')).toMatch(
      /fuera del alcance/,
    );

    const negative = await validate({ Stock: -1 });
    expect(negative.previewRows[0].errors.join(' ')).toMatch(
      /Stock debe ser mayor o igual a cero/,
    );

    const inverted = await validate({
      'Stock minimo': 5,
      'Stock maximo': 2,
    });
    expect(inverted.previewRows[0].errors.join(' ')).toMatch(
      /Stock maximo no puede ser menor/,
    );

    const fractional = await validate({ Stock: 1.5 });
    expect(fractional.previewRows[0].errors.join(' ')).toMatch(
      /no admite decimales/,
    );
  });

  it('confirma ajuste con kardex ADJUST sin tocar estructura ni CPP', async () => {
    const buffer = await workbookBuffer([
      baseRow({
        Stock: 8,
        'Stock minimo': 2,
        'Stock maximo': 12,
        'Ubicacion stock': 'B-2',
        CPP: 9999,
      }),
    ]);
    jest.spyOn(service, 'validateInventoryMasterImport').mockResolvedValue({
      domain: 'inventory',
      version: '1',
      summary: {
        rows: 1,
        creates: 0,
        updates: 1,
        unchanged: 0,
        errors: 0,
        deleteCandidates: 0,
      },
      requirements: [],
      previewRows: [
        {
          rowNumber: 6,
          action: 'UPDATE',
          itemId,
          inventoryCode: 'IN0001',
          partNumber: 'PN-001',
          warehouseCode: 'B01',
          label: 'IN0001 · PN-001 · Filtro aceite',
          errors: [],
          warnings: [],
          changes: [{ field: 'stock.quantity', before: 5, after: 8 }],
        },
      ],
      deleteCandidates: [],
      configuration: { requiredBeforeCommit: [], options: {} },
    } as never);
    prisma.warehouse.findMany.mockResolvedValueOnce([warehouse()] as never);
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: itemId, inventoryCode: 'IN0001', partNumber: 'PN-001' },
    ] as never);
    prisma.itemStock.findUnique.mockResolvedValue({
      id: 'stock-1',
      quantity: 5,
      unitCost: new Prisma.Decimal(123),
    } as never);
    prisma.itemStock.upsert.mockResolvedValue({ id: 'stock-1' } as never);
    prisma.inventoryTransaction.create.mockResolvedValue({
      id: 'tx-1',
    } as never);

    const result = await service.commitInventoryMasterImport(
      buffer,
      user,
      { allowStockAdjustments: true },
      'stock-operativo.xlsx',
    );

    expect(result.stockAdjusted).toBe(1);
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma.inventoryItem.delete).not.toHaveBeenCalled();
    expect(prisma.itemStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          quantity: 8,
          unitCost: new Prisma.Decimal(123),
          minStock: 2,
          maxStock: 12,
          location: 'B-2',
        }),
      }),
    );
    expect(prisma.inventoryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ADJUST',
          quantity: 3,
          previousStock: 5,
          newStock: 8,
          notes: expect.stringContaining(
            'Ajuste desde importacion Excel inventario · fila 6 · archivo stock-operativo.xlsx',
          ),
        }),
      }),
    );
  });

  it('no ajusta stock si allowStockAdjustments=false', async () => {
    const buffer = await workbookBuffer([baseRow({ Stock: 8 })]);
    jest.spyOn(service, 'validateInventoryMasterImport').mockResolvedValue({
      domain: 'inventory',
      version: '1',
      summary: {
        rows: 1,
        creates: 0,
        updates: 1,
        unchanged: 0,
        errors: 0,
        deleteCandidates: 0,
      },
      requirements: [],
      previewRows: [
        {
          rowNumber: 6,
          action: 'UPDATE',
          itemId,
          inventoryCode: 'IN0001',
          partNumber: 'PN-001',
          warehouseCode: 'B01',
          label: 'IN0001',
          errors: [],
          warnings: [],
          changes: [{ field: 'stock.quantity', before: 5, after: 8 }],
        },
      ],
      deleteCandidates: [],
      configuration: { requiredBeforeCommit: [], options: {} },
    } as never);

    await expect(
      service.commitInventoryMasterImport(
        buffer,
        user,
        { allowStockAdjustments: false },
        'stock.xlsx',
      ),
    ).rejects.toThrow(/allowStockAdjustments=false/);
    expect(prisma.itemStock.upsert).not.toHaveBeenCalled();
  });
});

describe('InventoryItemsService — search', () => {
  let service: InventoryItemsService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const itemId = '22222222-2222-2222-2222-222222222222';
  const user = { id: '77777777-7777-7777-7777-777777777777', tenantId };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryItemsService);
  });

  it('devuelve vacío con consulta menor a 2 caracteres', async () => {
    const rows = await service.search(user, 'a');

    expect(rows).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('devuelve vacío sin coincidencias trgm', async () => {
    prisma.$queryRaw.mockResolvedValue([] as never);

    const rows = await service.search(user, 'filtro');

    expect(rows).toEqual([]);
  });

  it('ordena resultados según ranking de búsqueda', async () => {
    const secondId = '33333333-3333-3333-3333-333333333333';
    prisma.$queryRaw.mockResolvedValue([
      { id: secondId },
      { id: itemId },
    ] as never);
    prisma.inventoryItem.findMany.mockResolvedValue([
      { id: itemId, name: 'Primero en DB', inventoryCode: 'IN0001' },
      { id: secondId, name: 'Segundo en DB', inventoryCode: 'IN0002' },
    ] as never);

    const rows = await service.search(user, 'filtro');

    expect(rows.map((r) => r.id)).toEqual([secondId, itemId]);
  });
});

describe('InventoryItemsService — create', () => {
  let service: InventoryItemsService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const categoryId = '44444444-4444-4444-4444-444444444444';
  const parentCategoryId = '55555555-5555-5555-5555-555555555555';
  const uomId = '66666666-6666-6666-6666-666666666666';
  const user = { id: '77777777-7777-7777-7777-777777777777', tenantId };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryItemsService);
  });

  it('exige categoría y unidad de medida', async () => {
    await expect(
      service.create(
        { name: 'X', categoryId: '', unitOfMeasureId: uomId } as never,
        user,
      ),
    ).rejects.toThrow(/familia y subcategoría/);

    await expect(
      service.create(
        { name: 'X', categoryId, unitOfMeasureId: '' } as never,
        user,
      ),
    ).rejects.toThrow(/unidad de medida/);
  });

  it('rechaza part number duplicado en el tenant', async () => {
    prisma.itemCategory.findFirst
      .mockResolvedValueOnce({
        id: categoryId,
        parentCategoryId,
      } as never)
      .mockResolvedValueOnce({ id: parentCategoryId } as never);
    prisma.unitOfMeasure.findFirst.mockResolvedValue({ id: uomId } as never);
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 'existing',
      inventoryCode: 'IN0099',
      name: 'Existente',
    } as never);

    await expect(
      service.create(
        {
          name: 'Nuevo',
          categoryId,
          unitOfMeasureId: uomId,
          partNumber: 'PN-DUP',
        } as never,
        user,
      ),
    ).rejects.toThrow(/Número de Parte/);
  });

  it('rechaza inventoryCode enviado por el cliente', async () => {
    prisma.itemCategory.findFirst
      .mockResolvedValueOnce({
        id: categoryId,
        parentCategoryId,
      } as never)
      .mockResolvedValueOnce({ id: parentCategoryId } as never);
    prisma.unitOfMeasure.findFirst.mockResolvedValue({ id: uomId } as never);
    prisma.inventoryItem.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        {
          name: 'Nuevo',
          categoryId,
          unitOfMeasureId: uomId,
          inventoryCode: 'IN9999',
        } as never,
        user,
      ),
    ).rejects.toThrow(/código de inventario lo asigna el sistema/);
  });
});

describe('InventoryItemsService — remove', () => {
  let service: InventoryItemsService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const itemId = '22222222-2222-2222-2222-222222222222';
  const user = { id: '77777777-7777-7777-7777-777777777777', tenantId };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryItemsService);
  });

  it('traduce error de FK al eliminar con historial', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: itemId } as never);
    prisma.inventoryItem.delete.mockRejectedValue(new Error('FK violation'));

    await expect(service.remove(itemId, user)).rejects.toThrow(
      /historial de stock/,
    );
  });
});

describe('InventoryItemsService — quickCreate', () => {
  let service: InventoryItemsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let sequenceService: DeepMockProxy<SequenceService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const categoryId = '44444444-4444-4444-4444-444444444444';
  const parentCategoryId = '55555555-5555-5555-5555-555555555555';
  const uomId = '66666666-6666-6666-6666-666666666666';
  const warehouseId = '88888888-8888-8888-8888-888888888888';
  const user = { id: '77777777-7777-7777-7777-777777777777', tenantId };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    sequenceService = mockDeep<SequenceService>();
    sequenceService.getNextCorrelative.mockResolvedValue('IN0200');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryItemsService);
    prisma.$transaction.mockImplementation(async (fn, _opts) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
  });

  function mockCategoryAndUom(): void {
    tx.itemCategory.findFirst
      .mockResolvedValueOnce({
        id: categoryId,
        parentCategoryId,
      } as never)
      .mockResolvedValueOnce({ id: parentCategoryId } as never);
    tx.unitOfMeasure.findFirst.mockResolvedValue({ id: uomId } as never);
  }

  it('exige nombre no vacío', async () => {
    await expect(
      service.quickCreate(
        { name: '   ', categoryId, unitOfMeasureId: uomId } as never,
        user,
      ),
    ).rejects.toThrow(/nombre del artículo/);
  });

  it('rechaza política min/max inválida con bodega', async () => {
    mockCategoryAndUom();
    tx.inventoryItem.findMany.mockResolvedValue([] as never);
    tx.warehouse.findFirst.mockResolvedValue({ id: warehouseId } as never);

    await expect(
      service.quickCreate(
        {
          name: 'Artículo rápido',
          categoryId,
          unitOfMeasureId: uomId,
          warehouseId,
          minStock: 10,
          maxStock: 5,
        } as never,
        user,
      ),
    ).rejects.toThrow(/máximo no puede ser menor/);
  });

  it('crea artículo con SKU autogenerado y política en bodega', async () => {
    mockCategoryAndUom();
    tx.inventoryItem.findMany.mockResolvedValue([] as never);
    tx.warehouse.findFirst.mockResolvedValue({ id: warehouseId } as never);
    tx.inventoryItem.create.mockResolvedValue({
      id: 'item-quick',
      inventoryCode: 'IN0200',
      qrCode: 'INV:item-quick',
      partNumber: null,
      name: 'Artículo rápido',
      categoryId,
      unitOfMeasure: { id: uomId, name: 'UN', abbreviation: 'UN' },
      itemCategory: { id: categoryId, name: 'Sub' },
    } as never);

    const created = await service.quickCreate(
      {
        name: 'Artículo rápido',
        categoryId,
        unitOfMeasureId: uomId,
        warehouseId,
        minStock: 2,
        maxStock: 20,
      } as never,
      user,
    );

    expect(created.inventoryCode).toBe('IN0200');
    expect(tx.inventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          policyTargetWarehouseId: warehouseId,
          policyMinStock: 2,
          policyMaxStock: 20,
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('rechaza part number duplicado (unique compuesto)', async () => {
    prisma.inventoryItem.findUnique.mockResolvedValue({
      inventoryCode: 'IN0005',
      name: 'Existente',
    } as never);

    await expect(
      service.quickCreate(
        {
          name: 'Nuevo',
          categoryId,
          unitOfMeasureId: uomId,
          partNumber: 'PN-DUP',
        } as never,
        user,
      ),
    ).rejects.toThrow(/Ya existe un artículo con este Número de Parte/);
  });
});

describe('InventoryItemsService — update', () => {
  let service: InventoryItemsService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const itemId = '22222222-2222-4222-8222-222222222222';
  const categoryId = '44444444-4444-4444-4444-444444444444';
  const parentCategoryId = '55555555-5555-5555-5555-555555555555';
  const uomId = '66666666-6666-6666-6666-666666666666';
  const warehouseId = '88888888-8888-8888-8888-888888888888';
  const user = { id: '77777777-7777-7777-7777-777777777777', tenantId };

  const existingItem = {
    id: itemId,
    tenantId,
    name: 'Artículo base',
    inventoryCode: 'IN0001',
    partNumber: null,
    categoryId,
    unitOfMeasureId: uomId,
    description: null,
    brand: null,
    compatibilityInfo: null,
    isSerialized: false,
    isInventory: true,
    isAsset: false,
    isConsumable: true,
    itemCategory: { id: categoryId, name: 'Sub' },
    unitOfMeasure: { id: uomId, name: 'UN', abbreviation: 'UN' },
    inventorySupplier: null,
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryItemsService);
  });

  function mockCategoryAndUom(): void {
    prisma.itemCategory.findFirst
      .mockResolvedValueOnce({
        id: categoryId,
        parentCategoryId,
      } as never)
      .mockResolvedValueOnce({ id: parentCategoryId } as never);
    prisma.unitOfMeasure.findFirst.mockResolvedValue({ id: uomId } as never);
  }

  it('no permite modificar inventoryCode', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue(existingItem as never);

    await expect(
      service.update(itemId, { inventoryCode: 'IN9999' } as never, user),
    ).rejects.toThrow(/código de inventario no se puede modificar/);
  });

  it('rechaza part number duplicado de otro artículo', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue(existingItem as never);
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 'other-item',
      inventoryCode: 'IN0099',
      name: 'Otro',
    } as never);
    mockCategoryAndUom();

    await expect(
      service.update(itemId, { partNumber: 'PN-DUP' } as never, user),
    ).rejects.toThrow(/Ya existe un artículo con este Número de Parte/);
  });

  it('actualiza nombre conservando categoría y UoM', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue(existingItem as never);
    mockCategoryAndUom();
    prisma.inventoryItem.update.mockResolvedValue({
      ...existingItem,
      name: 'Artículo editado',
    } as never);

    const updated = await service.update(
      itemId,
      { name: 'Artículo editado' } as never,
      user,
    );

    expect(updated.name).toBe('Artículo editado');
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: itemId },
        data: expect.objectContaining({ name: 'Artículo editado' }),
      }),
    );
  });

  it('resuelve artículo por código IN en update', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
    jest.spyOn(service, 'findOne').mockResolvedValue(existingItem as never);
    mockCategoryAndUom();
    prisma.inventoryItem.update.mockResolvedValue({
      ...existingItem,
      description: 'Nueva descripción',
    } as never);

    await service.update(
      'IN0001',
      { description: 'Nueva descripción' } as never,
      user,
    );

    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: itemId } }),
    );
  });

  it('ignora warehouseId y política min/max (no están en UpdateInventoryItemDto)', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue(existingItem as never);
    mockCategoryAndUom();
    prisma.inventoryItem.update.mockResolvedValue({
      ...existingItem,
      name: 'Sin política en update',
    } as never);

    await service.update(
      itemId,
      {
        name: 'Sin política en update',
        warehouseId: warehouseId,
        minStock: 5,
        maxStock: 50,
      } as never,
      user,
    );

    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          policyTargetWarehouseId: expect.anything(),
          policyMinStock: expect.anything(),
          policyMaxStock: expect.anything(),
        }),
      }),
    );
  });
});
