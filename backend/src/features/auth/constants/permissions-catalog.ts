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

/** Catálogo data-driven para UI de gobernanza de roles (módulo Inventario). */
export const INVENTORY_PERMISSIONS_CATALOG: PermissionCatalogModule[] = [
  {
    module: 'Inventario',
    groups: [
      {
        name: 'Artículos (catálogo maestro)',
        permissions: [
          {
            key: SystemPermissions.INVENTORY_ITEM_READ,
            label: 'Ver artículos',
            description:
              'Listar catálogo, buscar, picker, ficha, kardex por ítem, adjuntos y etiqueta PDF.',
          },
          {
            key: SystemPermissions.INVENTORY_ITEM_CREATE,
            label: 'Crear artículos',
            description: 'Alta completa o rápida (quick-create) en el catálogo.',
          },
          {
            key: SystemPermissions.INVENTORY_ITEM_UPDATE,
            label: 'Editar artículos',
            description: 'Modificar ficha del ítem y gestionar adjuntos.',
          },
          {
            key: SystemPermissions.INVENTORY_ITEM_DELETE,
            label: 'Desactivar artículos',
            description: 'Desactivar o eliminar artículos del catálogo (según reglas del servicio).',
          },
        ],
      },
      {
        name: 'Bodegas',
        permissions: [
          {
            key: SystemPermissions.INVENTORY_WAREHOUSE_READ,
            label: 'Ver bodegas',
            description: 'Listar bodegas, detalle y ubicaciones (bins) por almacén.',
          },
          {
            key: SystemPermissions.INVENTORY_WAREHOUSE_MANAGE,
            label: 'Gestionar bodegas',
            description: 'Crear, editar y desactivar bodegas y sus ubicaciones internas.',
          },
        ],
      },
      {
        name: 'Categorías y familias',
        permissions: [
          {
            key: SystemPermissions.INVENTORY_CATEGORY_READ,
            label: 'Ver categorías',
            description: 'Consultar familias, subfamilias y jerarquía de categorías.',
          },
          {
            key: SystemPermissions.INVENTORY_CATEGORY_MANAGE,
            label: 'Gestionar categorías',
            description: 'Crear, editar y eliminar familias / categorías de ítems.',
          },
        ],
      },
      {
        name: 'Transferencias entre bodegas (W2W)',
        permissions: [
          {
            key: SystemPermissions.INVENTORY_TRANSFER_READ,
            label: 'Ver transferencias',
            description: 'Listar y consultar detalle de traslados W2W.',
          },
          {
            key: SystemPermissions.INVENTORY_TRANSFER_CREATE,
            label: 'Solicitar traslado',
            description: 'Crear y despachar transferencia desde bodega origen.',
          },
          {
            key: SystemPermissions.INVENTORY_TRANSFER_APPROVE,
            label: 'Confirmar recepción',
            description: 'Confirmar ingreso en bodega destino (movimiento a stock).',
          },
        ],
      },
      {
        name: 'Stock y ajustes',
        permissions: [
          {
            key: SystemPermissions.INVENTORY_STOCK_READ,
            label: 'Ver stock',
            description:
              'Saldos por bodega, kardex, alertas de abastecimiento, reservas y reportes operativos de stock.',
          },
          {
            key: SystemPermissions.INVENTORY_STOCK_ADJUST,
            label: 'Ajustar stock',
            description:
              'Movimientos manuales, devoluciones, niveles min/max y ajustes de inventario físico (kardex).',
          },
        ],
      },
    ],
  },
];

/** Catálogo data-driven para UI de gobernanza de roles (módulo Operaciones). */
export const OPERATIONS_PERMISSIONS_CATALOG: PermissionCatalogModule[] = [
  {
    module: 'Operaciones',
    groups: [
      {
        name: 'Flota y equipos',
        permissions: [
          {
            key: SystemPermissions.OPERATIONS_EQUIPMENT_READ,
            label: 'Ver equipos',
            description:
              'Listar flota, ficha, analytics de equipo y tablero de captura de horómetro.',
          },
          {
            key: SystemPermissions.OPERATIONS_EQUIPMENT_CREATE,
            label: 'Crear equipos',
            description: 'Alta de activos en el maestro de flota.',
          },
          {
            key: SystemPermissions.OPERATIONS_EQUIPMENT_UPDATE,
            label: 'Editar equipos',
            description: 'Modificar ficha, datos operativos y documentación del activo.',
          },
          {
            key: SystemPermissions.OPERATIONS_EQUIPMENT_DELETE,
            label: 'Desactivar equipos',
            description: 'Desactivar o dar de baja equipos del maestro (según reglas del servicio).',
          },
        ],
      },
      {
        name: 'Órdenes de trabajo',
        permissions: [
          {
            key: SystemPermissions.OPERATIONS_WORK_ORDER_READ,
            label: 'Ver OTs',
            description:
              'Listar órdenes de trabajo, detalle, estadísticas y analítica operativa de OTs.',
          },
          {
            key: SystemPermissions.OPERATIONS_WORK_ORDER_CREATE,
            label: 'Crear OT',
            description: 'Abrir una nueva orden de trabajo.',
          },
          {
            key: SystemPermissions.OPERATIONS_WORK_ORDER_UPDATE,
            label: 'Editar OT (planificación)',
            description:
              'Modificar cabecera, planificación, clasificación y datos generales de la OT.',
          },
          {
            key: SystemPermissions.OPERATIONS_WORK_ORDER_ASSIGN,
            label: 'Asignar personal',
            description:
              'Asignar mecánicos participantes, supervisor de turno y responsables en la OT.',
          },
          {
            key: SystemPermissions.OPERATIONS_WORK_ORDER_EXECUTE,
            label: 'Ejecutar OT',
            description:
              'Registrar consumos, tareas, horas, fluidos, repuestos y cambios de estado operativo.',
          },
          {
            key: SystemPermissions.OPERATIONS_WORK_ORDER_CLOSE,
            label: 'Cerrar OT',
            description:
              'Cierre técnico y documental: validación de detención, consumo de stock y cierre formal.',
          },
        ],
      },
      {
        name: 'Horómetros',
        permissions: [
          {
            key: SystemPermissions.OPERATIONS_METER_READING_READ,
            label: 'Ver lecturas',
            description:
              'Consultar historial de lecturas, snapshot de medidor y tablero de captura.',
          },
          {
            key: SystemPermissions.OPERATIONS_METER_READING_CREATE,
            label: 'Registrar lecturas',
            description:
              'Captura individual, masiva (bulk-sync) y ajustes justificados de horómetro.',
          },
        ],
      },
      {
        name: 'Pautas de mantenimiento (kits PM)',
        permissions: [
          {
            key: SystemPermissions.OPERATIONS_MAINTENANCE_READ,
            label: 'Ver pautas',
            description: 'Consultar kits / pautas de mantenimiento preventivo.',
          },
          {
            key: SystemPermissions.OPERATIONS_MAINTENANCE_MANAGE,
            label: 'Gestionar pautas',
            description: 'Crear, editar y eliminar kits de mantenimiento.',
          },
        ],
      },
      {
        name: 'Backlog de OT',
        permissions: [
          {
            key: SystemPermissions.OPERATIONS_BACKLOG_READ,
            label: 'Ver backlog',
            description: 'Listar ítems de backlog asociados a órdenes de trabajo.',
          },
          {
            key: SystemPermissions.OPERATIONS_BACKLOG_MANAGE,
            label: 'Gestionar backlog',
            description:
              'Agregar, actualizar, promover ítems de backlog y convertirlos en tareas u OT.',
          },
        ],
      },
    ],
  },
];

/** Catálogo PBAC — Administración y configuración transversal. */
export const ADMIN_CONFIG_PERMISSIONS_CATALOG: PermissionCatalogModule[] = [
  {
    module: 'Administración',
    groups: [
      {
        name: 'Usuarios',
        permissions: [
          {
            key: SystemPermissions.ADMIN_USER_READ,
            label: 'Ver usuarios',
            description:
              'Listar usuarios del tenant, búsqueda y detalle administrativo.',
          },
          {
            key: SystemPermissions.ADMIN_USER_CREATE,
            label: 'Invitar usuarios',
            description: 'Crear usuarios e invitaciones al tenant.',
          },
          {
            key: SystemPermissions.ADMIN_USER_UPDATE,
            label: 'Editar usuarios',
            description:
              'Actualizar datos, activar/desactivar, reenviar invitación y restablecer contraseña.',
          },
          {
            key: SystemPermissions.ADMIN_USER_DELETE,
            label: 'Eliminar usuarios',
            description: 'Eliminar usuarios del tenant.',
          },
          {
            key: SystemPermissions.ADMIN_USER_MANAGE_ROLES,
            label: 'Gestionar roles de usuario',
            description:
              'Asignar roles personalizados, editar matriz PBAC y gobernanza de roles del tenant.',
          },
        ],
      },
    ],
  },
  {
    module: 'Configuración',
    groups: [
      {
        name: 'Empresa',
        permissions: [
          {
            key: SystemPermissions.ADMIN_TENANT_CONFIG_READ,
            label: 'Ver configuración de empresa',
            description:
              'Acceder a la pantalla de datos fiscales, marca y logos (lectura).',
          },
          {
            key: SystemPermissions.ADMIN_TENANT_CONFIG_UPDATE,
            label: 'Editar configuración de empresa',
            description:
              'Modificar datos de empresa y subir logos (menú, claro, PDF).',
          },
        ],
      },
      {
        name: 'Contratos',
        permissions: [
          {
            key: SystemPermissions.ADMIN_CONTRACT_READ,
            label: 'Ver contratos',
            description:
              'Listar contratos y subcontratos (incluye selector del header).',
          },
          {
            key: SystemPermissions.ADMIN_CONTRACT_MANAGE,
            label: 'Gestionar contratos',
            description:
              'Crear, editar y eliminar contratos y subcontratos.',
          },
        ],
      },
      {
        name: 'Notificaciones',
        permissions: [
          {
            key: SystemPermissions.ADMIN_NOTIFICATION_READ,
            label: 'Ver gobernanza de notificaciones',
            description:
              'Consultar matriz de eventos, suscriptores y preferencias de otros usuarios.',
          },
          {
            key: SystemPermissions.ADMIN_NOTIFICATION_MANAGE_SETTINGS,
            label: 'Configurar notificaciones',
            description:
              'Editar opt-in global, CC por evento y preferencias delegadas de otros usuarios.',
          },
        ],
      },
    ],
  },
  {
    module: 'Principal',
    groups: [
      {
        name: 'Dashboard',
        permissions: [
          {
            key: SystemPermissions.CORE_DASHBOARD_READ,
            label: 'Ver dashboard',
            description: 'Acceder a la vista principal del ERP.',
          },
        ],
      },
    ],
  },
];

export function getPermissionsCatalog(): PermissionCatalogModule[] {
  return [
    ...PURCHASES_PERMISSIONS_CATALOG,
    ...INVENTORY_PERMISSIONS_CATALOG,
    ...OPERATIONS_PERMISSIONS_CATALOG,
    ...ADMIN_CONFIG_PERMISSIONS_CATALOG,
  ];
}
