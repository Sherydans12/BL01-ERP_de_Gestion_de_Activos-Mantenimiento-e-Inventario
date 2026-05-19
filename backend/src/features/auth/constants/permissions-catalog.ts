import { SystemPermissions } from './permissions.enum';

export interface PermissionCatalogEntry {
  key: string;
  label: string;
  description: string;
}

export interface PermissionCatalogGroup {
  name: string;
  permissions: PermissionCatalogEntry[];
}

export interface PermissionCatalogModule {
  module: string;
  groups: PermissionCatalogGroup[];
}

/** Catálogo data-driven para UI de gobernanza de roles (módulo Compras). */
export const PURCHASES_PERMISSIONS_CATALOG: PermissionCatalogModule[] = [
  {
    module: 'Compras',
    groups: [
      {
        name: 'Requerimientos de Compra',
        permissions: [
          {
            key: SystemPermissions.PURCHASES_REQUISITION_READ,
            label: 'Ver requerimientos',
            description:
              'Listar, consultar detalle, PDF e historial de requerimientos de compra.',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_CREATE,
            label: 'Crear borrador',
            description: 'Crear un requerimiento de compra en estado borrador (DRAFT).',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_UPDATE_OWN,
            label: 'Editar (solicitante)',
            description:
              'Editar borradores propios: ítems, prioridad y datos generales.',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_UPDATE_PURCHASING,
            label: 'Editar (compras)',
            description:
              'Editar en fase de cotización, pendiente de OC o compra parcial.',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_UPDATE_ASSET_LINK,
            label: 'Vincular OT / equipo',
            description:
              'Asociar o corregir orden de trabajo y equipo en borrador o enviado.',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_SUBMIT,
            label: 'Enviar requerimiento',
            description: 'Enviar el SRC para revisión de compras (SUBMITTED).',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_CANCEL,
            label: 'Cancelar',
            description: 'Cancelar un requerimiento activo.',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_START_QUOTING,
            label: 'Iniciar cotización',
            description: 'Pasar el SRC a fase de cotización con proveedores.',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_MANAGE_QUOTATIONS,
            label: 'Gestionar cotizaciones',
            description: 'Registrar cotizaciones y seleccionar ganadora a nivel cabecera.',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_AWARD_LINES,
            label: 'Adjudicar líneas',
            description: 'Asignar proveedor, cantidad y precio por línea antes de la OC.',
          },
          {
            key: SystemPermissions.PURCHASES_REQUISITION_DUPLICATE,
            label: 'Duplicar',
            description: 'Duplicar un requerimiento como plantilla en borrador.',
          },
        ],
      },
      {
        name: 'Órdenes de Compra',
        permissions: [
          {
            key: SystemPermissions.PURCHASES_ORDER_READ,
            label: 'Ver órdenes de compra',
            description: 'Listar OC, detalle, PDF, historial y elegibles para recepción.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_CREATE_FROM_REQUISITION,
            label: 'Crear desde requerimiento',
            description: 'Generar OC a partir de un SRC adjudicado.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_CREATE_FROM_QUOTATION,
            label: 'Crear desde cotización',
            description: 'Generar OC desde una cotización seleccionada.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_APPROVE,
            label: 'Aprobar flujo',
            description: 'Aprobar la OC en el flujo de firmas por monto.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_SEND_TO_SUPPLIER,
            label: 'Enviar a proveedor',
            description: 'Marcar la OC como emitida al proveedor.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_CANCEL,
            label: 'Cancelar OC',
            description: 'Cancelar una orden de compra activa.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_FORCE_CLOSE,
            label: 'Forzar cierre',
            description: 'Cerrar OC con pendientes (recepciones/facturas) con motivo.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_REJECT,
            label: 'Rechazar aprobación',
            description: 'Rechazar OC en flujo de firmas.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_RESET_DRAFT,
            label: 'Revertir a borrador',
            description: 'Operación sensible: devolver OC a borrador.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_UPDATE_LOGISTICS,
            label: 'Logística',
            description: 'Actualizar dirección de entrega y condiciones de pago.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_UPDATE_SENSITIVE,
            label: 'Campos sensibles',
            description: 'Modificar montos, proveedor o líneas permitidas.',
          },
          {
            key: SystemPermissions.PURCHASES_ORDER_LINK_CATALOG,
            label: 'Vincular catálogo',
            description: 'Vincular línea de OC a artículo de inventario.',
          },
        ],
      },
      {
        name: 'Recepciones de Bodega',
        permissions: [
          {
            key: SystemPermissions.PURCHASES_RECEIPT_READ,
            label: 'Ver recepciones',
            description: 'Listar guías, detalle e historial de recepción.',
          },
          {
            key: SystemPermissions.PURCHASES_RECEIPT_CREATE,
            label: 'Abrir guía',
            description: 'Crear guía de recepción contra OC y bodega.',
          },
          {
            key: SystemPermissions.PURCHASES_RECEIPT_REGISTER,
            label: 'Registrar recepción',
            description: 'Capturar cantidades y confirmar movimiento a stock.',
          },
        ],
      },
      {
        name: 'Facturas y Conciliación',
        permissions: [
          {
            key: SystemPermissions.PURCHASES_INVOICE_READ,
            label: 'Ver facturas',
            description: 'Listar facturas, detalle y calendario de pagos.',
          },
          {
            key: SystemPermissions.PURCHASES_INVOICE_CREATE,
            label: 'Cargar factura',
            description: 'Registrar factura de proveedor con PDF.',
          },
          {
            key: SystemPermissions.PURCHASES_INVOICE_UPDATE,
            label: 'Editar factura',
            description: 'Corregir datos de factura no pagada.',
          },
          {
            key: SystemPermissions.PURCHASES_INVOICE_VALIDATE,
            label: 'Validar 3-Way Match',
            description: 'Ejecutar conciliación OC ↔ recepción ↔ factura.',
          },
          {
            key: SystemPermissions.PURCHASES_INVOICE_OVERRULE,
            label: 'Autorizar discrepancias',
            description: 'Aprobar excepción manual en 3-way match.',
          },
          {
            key: SystemPermissions.PURCHASES_INVOICE_MARK_PAID,
            label: 'Marcar pagada',
            description: 'Registrar pago o marcar factura como pagada.',
          },
          {
            key: SystemPermissions.PURCHASES_INVOICE_DELETE,
            label: 'Eliminar factura',
            description: 'Eliminar factura no pagada (con auditoría).',
          },
          {
            key: SystemPermissions.PURCHASES_CREDIT_NOTE_MANAGE,
            label: 'Notas de crédito',
            description: 'Gestionar notas de crédito asociadas a una OC.',
          },
        ],
      },
      {
        name: 'Configuración y Proveedores',
        permissions: [
          {
            key: SystemPermissions.PURCHASES_SETTING_READ,
            label: 'Ver configuración P2P',
            description: 'Consultar parámetros y políticas de aprobación.',
          },
          {
            key: SystemPermissions.PURCHASES_SETTING_UPDATE,
            label: 'Editar configuración P2P',
            description: 'Modificar umbrales, moneda y matriz de firmas.',
          },
          {
            key: SystemPermissions.PURCHASES_VENDOR_READ,
            label: 'Ver proveedores',
            description: 'Consultar maestro de proveedores.',
          },
          {
            key: SystemPermissions.PURCHASES_VENDOR_CREATE,
            label: 'Crear proveedor',
            description: 'Alta de proveedor en el catálogo.',
          },
          {
            key: SystemPermissions.PURCHASES_VENDOR_UPDATE,
            label: 'Editar proveedor',
            description: 'Modificar datos del proveedor.',
          },
          {
            key: SystemPermissions.PURCHASES_VENDOR_DELETE,
            label: 'Eliminar proveedor',
            description: 'Desactivar o eliminar proveedor.',
          },
        ],
      },
      {
        name: 'Documentos y Analítica',
        permissions: [
          {
            key: SystemPermissions.PURCHASES_DOCUMENT_READ,
            label: 'Ver adjuntos',
            description: 'Listar y descargar documentos P2P.',
          },
          {
            key: SystemPermissions.PURCHASES_DOCUMENT_MANAGE,
            label: 'Gestionar adjuntos',
            description: 'Subir y eliminar documentos adjuntos.',
          },
          {
            key: SystemPermissions.PURCHASES_ANALYTICS_READ,
            label: 'Reportes de compras',
            description: 'Dashboard y reportes PDF de compras.',
          },
        ],
      },
    ],
  },
];

export function getPermissionsCatalog(): PermissionCatalogModule[] {
  return PURCHASES_PERMISSIONS_CATALOG;
}
