import { CatalogItem, Equipment } from '@prisma/client';
import {
  buildBaseLogicMasterWorkbook,
  type MasterExportCatalogSheet,
  type MasterExportColumn,
} from '../../common/excel/baselogic-master-export.util';

type FleetExportEquipment = Equipment & {
  contract: { code: string; name: string } | null;
  subcontract: { code: string; name: string } | null;
};

type FleetContractRow = {
  code: string;
  name: string;
  type: 'Contrato' | 'Subcontrato';
  parentCode: string | null;
};

type FleetMasterExportData = {
  tenantName: string;
  generatedAt: Date;
  equipments: FleetExportEquipment[];
  equipmentTypes: CatalogItem[];
  contractRows: FleetContractRow[];
};

const FLEET_COLUMNS: MasterExportColumn[] = [
  {
    header: 'ID sistema',
    key: 'id',
    width: 38,
    note: 'UUID del registro. Mantener para futuras importaciones controladas.',
  },
  {
    header: 'N interno',
    key: 'internalId',
    width: 14,
    note: 'Identificador interno operacional del equipo. Debe ser unico por empresa.',
  },
  {
    header: 'Familia',
    key: 'family',
    width: 10,
    note: 'Codigo/familia del tipo de equipo.',
  },
  {
    header: 'Patente',
    key: 'plate',
    width: 12,
    note: 'Patente unica. Dejar vacia si no aplica.',
  },
  { header: 'NIC mina', key: 'mineInternalId', width: 16 },
  { header: 'N serie', key: 'serialNumber', width: 18 },
  { header: 'Marca', key: 'brand', width: 18 },
  { header: 'Modelo', key: 'model', width: 22 },
  { header: 'Ano', key: 'year', width: 10 },
  { header: 'Tipo equipo', key: 'type', width: 28 },
  { header: 'Codigo tipo catalogo', key: 'typeCatalogCode', width: 18 },
  { header: 'Contrato', key: 'contractCode', width: 12 },
  { header: 'Nombre contrato', key: 'contractName', width: 24 },
  { header: 'Subcontrato', key: 'subcontractCode', width: 14 },
  { header: 'Nombre subcontrato', key: 'subcontractName', width: 24 },
  {
    header: 'Operativo',
    key: 'isOperational',
    width: 12,
    note: 'SI = equipo operativo; NO = fuera de servicio.',
  },
  {
    header: 'Tipo medidor',
    key: 'meterType',
    width: 14,
    note: 'HOURS o KILOMETERS.',
  },
  { header: 'Medidor inicial', key: 'initialMeter', width: 14 },
  { header: 'Medidor actual', key: 'currentMeter', width: 14 },
  { header: 'Propiedad', key: 'ownership', width: 16 },
  { header: 'Subarriendo', key: 'isSubleased', width: 12 },
  { header: 'Empresa subarriendo', key: 'subleaseCompanyName', width: 26 },
  { header: 'Frecuencia mantencion', key: 'maintenanceFrequency', width: 18 },
  { header: 'Intervalo PM', key: 'pmIntervalOverride', width: 14 },
  {
    header: 'Ultima PM fecha',
    key: 'lastMaintenanceDate',
    width: 16,
    numFmt: 'yyyy-mm-dd',
  },
  { header: 'Ultima PM medidor', key: 'lastMaintenanceMeter', width: 18 },
  { header: 'Tipo ultima PM', key: 'lastMaintenanceType', width: 18 },
  {
    header: 'Revision tecnica vence',
    key: 'techReviewExp',
    width: 18,
    numFmt: 'yyyy-mm-dd',
  },
  {
    header: 'Permiso circulacion vence',
    key: 'circPermitExp',
    width: 22,
    numFmt: 'yyyy-mm-dd',
  },
  {
    header: 'SOAP/seguro vence',
    key: 'soapExp',
    width: 18,
    numFmt: 'yyyy-mm-dd',
  },
  {
    header: 'Certificado mecanico vence',
    key: 'mechanicalCertExp',
    width: 24,
    numFmt: 'yyyy-mm-dd',
  },
  {
    header: 'Poliza RC vence',
    key: 'liabilityPolicyExp',
    width: 18,
    numFmt: 'yyyy-mm-dd',
  },
  { header: 'VIN', key: 'vin', width: 22 },
  { header: 'N motor', key: 'engineNumber', width: 18 },
];

function boolLabel(value: boolean): string {
  return value ? 'SI' : 'NO';
}

function dateOnly(value: Date | null): Date | null {
  if (!value) return null;
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function familyFromCatalogCode(code: string | null): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  return trimmed.includes('-') ? trimmed.split('-')[0] : trimmed;
}

export async function generateFleetMasterExcelBuffer(
  data: FleetMasterExportData,
): Promise<Buffer> {
  const typeByName = new Map(
    data.equipmentTypes.map((type) => [type.name.trim().toUpperCase(), type]),
  );

  const rows = data.equipments.map((equipment) => {
    const catalogType = typeByName.get(equipment.type.trim().toUpperCase());
    const typeCatalogCode = catalogType?.code ?? null;
    return {
      id: equipment.id,
      internalId: equipment.internalId,
      family: familyFromCatalogCode(typeCatalogCode),
      plate: equipment.plate,
      mineInternalId: equipment.mineInternalId,
      serialNumber: equipment.serialNumber,
      brand: equipment.brand,
      model: equipment.model,
      year: equipment.year,
      type: equipment.type,
      typeCatalogCode,
      contractCode: equipment.contract?.code ?? null,
      contractName: equipment.contract?.name ?? null,
      subcontractCode: equipment.subcontract?.code ?? null,
      subcontractName: equipment.subcontract?.name ?? null,
      isOperational: boolLabel(equipment.isOperational),
      meterType: equipment.meterType,
      initialMeter: equipment.initialMeter,
      currentMeter: equipment.currentMeter,
      ownership: equipment.ownership,
      isSubleased: boolLabel(equipment.isSubleased),
      subleaseCompanyName: equipment.subleaseCompanyName,
      maintenanceFrequency: equipment.maintenanceFrequency,
      pmIntervalOverride: equipment.pmIntervalOverride,
      lastMaintenanceDate: dateOnly(equipment.lastMaintenanceDate),
      lastMaintenanceMeter: equipment.lastMaintenanceMeter,
      lastMaintenanceType: equipment.lastMaintenanceType,
      techReviewExp: dateOnly(equipment.techReviewExp),
      circPermitExp: dateOnly(equipment.circPermitExp),
      soapExp: dateOnly(equipment.soapExp),
      mechanicalCertExp: dateOnly(equipment.mechanicalCertExp),
      liabilityPolicyExp: dateOnly(equipment.liabilityPolicyExp),
      vin: equipment.vin,
      engineNumber: equipment.engineNumber,
    };
  });

  const catalogs: MasterExportCatalogSheet[] = [
    {
      name: 'Catalogos flota',
      columns: [
        { header: 'Tipo catalogo', key: 'catalog', width: 22 },
        { header: 'Codigo', key: 'code', width: 16 },
        { header: 'Nombre', key: 'name', width: 34 },
        { header: 'Padre', key: 'parentCode', width: 18 },
      ],
      rows: [
        ...data.equipmentTypes.map((type) => ({
          catalog: 'Tipo equipo',
          code: type.code,
          name: type.name,
          parentCode: familyFromCatalogCode(type.code),
        })),
        ...data.contractRows.map((row) => ({
          catalog: row.type,
          code: row.code,
          name: row.name,
          parentCode: row.parentCode,
        })),
        {
          catalog: 'Tipo medidor',
          code: 'HOURS',
          name: 'Horas',
          parentCode: null,
        },
        {
          catalog: 'Tipo medidor',
          code: 'KILOMETERS',
          name: 'Kilometros',
          parentCode: null,
        },
        { catalog: 'Booleano', code: 'SI', name: 'Si', parentCode: null },
        { catalog: 'Booleano', code: 'NO', name: 'No', parentCode: null },
      ],
    },
  ];

  const operationalCount = data.equipments.filter(
    (e) => e.isOperational,
  ).length;
  const subleasedCount = data.equipments.filter((e) => e.isSubleased).length;

  return buildBaseLogicMasterWorkbook({
    title: 'Maestro de Flota',
    subtitle:
      'Extraccion profesional de equipos para auditoria, traspaso e importacion controlada.',
    domain: 'fleet',
    tenantName: data.tenantName,
    generatedAt: data.generatedAt,
    columns: FLEET_COLUMNS,
    rows,
    summary: [
      ['Equipos', data.equipments.length],
      ['Operativos', operationalCount],
      ['Fuera de servicio', data.equipments.length - operationalCount],
      ['Subarrendados', subleasedCount],
      ['Tipos catalogados', data.equipmentTypes.length],
    ],
    notes: [
      'Los encabezados de la hoja Flota tienen comentarios con descriptores de uso.',
      'La hoja Catalogos flota contiene tipos de equipo, contratos, subcontratos y valores controlados.',
      'La hoja oculta _bl_import_contract deja versionado el contrato tecnico para una futura importacion.',
      'No elimine la columna ID sistema si quiere que el reimportador pueda actualizar registros existentes con maxima precision.',
    ],
    catalogs,
  });
}
