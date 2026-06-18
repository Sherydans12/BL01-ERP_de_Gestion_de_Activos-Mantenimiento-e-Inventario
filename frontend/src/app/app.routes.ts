import { Routes } from '@angular/router';
import { authGuard } from './core/services/auth/auth.guard';
import { permissionGuard } from './core/guards/permission.guard';
import { P, REQUISITION_EDIT_ANY } from './core/constants/purchases-permissions';
import { I } from './core/constants/inventory-permissions';
import { O } from './core/constants/operations-permissions';
import { A } from './core/constants/admin-permissions';
import { registroHorasCanDeactivate } from './features/meter-capture/registro-horas-can-deactivate.guard';
import { lubeReportCanDeactivate } from './features/operations/lube-reports/lube-report-can-deactivate.guard';
import { availabilityFormCanDeactivate } from './features/operations/availability/availability-form-can-deactivate.guard';
import { faultReportCanDeactivate } from './features/operations/fault-reports/fault-report-can-deactivate.guard';

export const routes: Routes = [
  {
    path: 'auth/login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(
        (m) => m.LoginComponent,
      ),
  },
  {
    path: 'auth/activate',
    loadComponent: () =>
      import('./features/auth/activate-account/activate-account.component').then(
        (m) => m.ActivateAccountComponent,
      ),
  },
  {
    path: 'auth/forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
  },
  {
    path: 'auth/reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password.component').then(
        (m) => m.ResetPasswordComponent,
      ),
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/layout/layout.component').then((m) => m.LayoutComponent),
    // Todo lo que esté aquí adentro se renderizará dentro del <router-outlet> del Layout
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard',
      },
      {
        path: 'dashboard',
        canActivate: [permissionGuard],
        data: { permissions: A.DASHBOARD_READ, pageTitle: 'Dashboard' },
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'configuracion',
        data: { pageTitle: 'Mi cuenta' },
        loadComponent: () =>
          import('./features/settings/user-account-settings/user-account-settings.component').then(
            (m) => m.UserAccountSettingsComponent,
          ),
      },
      {
        path: 'admin/security',
        canActivate: [authGuard],
        data: {
          roles: ['SUPER_ADMIN', 'ADMIN'],
          pageTitle: 'Seguridad global',
        },
        loadComponent: () =>
          import('./features/admin/admin-security/admin-security.component').then(
            (m) => m.AdminSecurityComponent,
          ),
      },
      {
        path: 'admin/platform-data',
        canActivate: [authGuard],
        data: {
          roles: ['SUPER_ADMIN'],
          pageTitle: 'Datos plataforma',
        },
        loadComponent: () =>
          import('./features/admin/platform-data-admin/platform-data-admin.component').then(
            (m) => m.PlatformDataAdminComponent,
          ),
      },
      // Futura ruta: { path: 'flota', component: FleetMasterComponent }
      // ── Operaciones — PBAC en permissionGuard ─────────────────────────────
      {
        path: 'flota',
        canActivate: [permissionGuard],
        data: { permissions: O.EQUIPMENT_READ, pageTitle: 'Maestro de Flota' },
        loadComponent: () =>
          import('./features/fleet/fleet-master/fleet-master.component').then(
            (m) => m.FleetMasterComponent,
          ),
      },
      {
        path: 'flota/importar',
        canActivate: [permissionGuard],
        data: {
          permissions: O.EQUIPMENT_UPDATE,
          pageTitle: 'Importar maestro de flota',
        },
        loadComponent: () =>
          import('./features/fleet/fleet-master-import/fleet-master-import.component').then(
            (m) => m.FleetMasterImportComponent,
          ),
      },
      {
        path: 'flota/registro-horas',
        canActivate: [permissionGuard],
        canDeactivate: [registroHorasCanDeactivate],
        data: {
          permissions: O.METER_READING_READ,
          pageTitle: 'Registro de horómetros',
        },
        loadComponent: () =>
          import('./features/meter-capture/registro-horas.component').then(
            (m) => m.RegistroHorasComponent,
          ),
      },
      {
        path: 'ots',
        canActivate: [permissionGuard],
        data: { permissions: O.WORK_ORDER_READ, pageTitle: 'Órdenes de Trabajo' },
        loadComponent: () =>
          import('./features/work-orders/work-order-list/work-order-list.component').then(
            (m) => m.WorkOrderListComponent,
          ),
      },
      {
        path: 'ots/nueva',
        canActivate: [permissionGuard],
        data: { permissions: O.WORK_ORDER_CREATE, pageTitle: 'Nueva orden de trabajo' },
        loadComponent: () =>
          import('./features/work-orders/work-order-form/work-order-form.component').then(
            (m) => m.WorkOrderFormComponent,
          ),
      },
      {
        path: 'ots/backlog',
        canActivate: [permissionGuard],
        data: { permissions: O.BACKLOG_READ, pageTitle: 'Backlog OT' },
        loadComponent: () =>
          import('./features/work-orders/work-order-backlog-list/work-order-backlog-list.component').then(
            (m) => m.WorkOrderBacklogListComponent,
          ),
      },
      {
        path: 'ots/analytics',
        canActivate: [permissionGuard],
        data: { permissions: O.WORK_ORDER_READ, pageTitle: 'Confiabilidad OT' },
        loadComponent: () =>
          import('./features/work-orders/work-order-analytics-dashboard/work-order-analytics-dashboard.component').then(
            (m) => m.WorkOrderAnalyticsDashboardComponent,
          ),
      },
      {
        path: 'operaciones/analytics',
        canActivate: [permissionGuard],
        data: { permissions: O.WORK_ORDER_READ, pageTitle: 'KPIs Operativos' },
        loadComponent: () =>
          import('./features/analytics/dashboard/dashboard.component').then(
            (m) => m.OperationsKpiDashboardComponent,
          ),
      },
      // ── Módulo: Despacho de Lubricantes ──────────────────────────────────
      {
        path: 'operaciones/lubricantes',
        canActivate: [permissionGuard],
        data: { permissions: O.LUBE_REPORT_READ, pageTitle: 'Despachos de Lubricantes' },
        loadComponent: () =>
          import('./features/operations/lube-reports/lube-report-list.component').then(
            (m) => m.LubeReportListComponent,
          ),
      },
      {
        path: 'operaciones/lubricantes/nuevo',
        canActivate: [permissionGuard],
        canDeactivate: [lubeReportCanDeactivate],
        data: { permissions: O.LUBE_REPORT_CREATE, pageTitle: 'Nuevo Despacho de Lubricante' },
        loadComponent: () =>
          import('./features/operations/lube-reports/lube-report-form.component').then(
            (m) => m.LubeReportFormComponent,
          ),
      },
      {
        path: 'ots/:id',
        canActivate: [permissionGuard],
        data: { permissions: O.WORK_ORDER_READ, pageTitle: 'Orden de trabajo' },
        loadComponent: () =>
          import('./features/work-orders/work-order-form/work-order-form.component').then(
            (m) => m.WorkOrderFormComponent,
          ),
      },
      /** Alias para deep links desde Kardex / documentación. */
      {
        path: 'mantenimiento/ot/:id',
        canActivate: [permissionGuard],
        data: { permissions: O.WORK_ORDER_READ, pageTitle: 'Orden de trabajo' },
        loadComponent: () =>
          import('./features/work-orders/work-order-form/work-order-form.component').then(
            (m) => m.WorkOrderFormComponent,
          ),
      },
      // ── Módulo: Disponibilidad Operativa Diaria ───────────────────────────
      {
        path: 'operaciones/disponibilidad/nuevo',
        canActivate: [permissionGuard],
        canDeactivate: [availabilityFormCanDeactivate],
        data: { permissions: O.AVAILABILITY_CREATE, pageTitle: 'Reporte de Disponibilidad' },
        loadComponent: () =>
          import('./features/operations/availability/availability-form.component').then(
            (m) => m.AvailabilityFormComponent,
          ),
      },
      {
        path: 'operaciones/disponibilidad/monitor',
        canActivate: [permissionGuard],
        data: { permissions: O.AVAILABILITY_MONITOR, pageTitle: 'Monitor de Flota' },
        loadComponent: () =>
          import('./features/operations/availability/availability-monitor.component').then(
            (m) => m.AvailabilityMonitorComponent,
          ),
      },
      {
        path: 'operaciones/disponibilidad/historial',
        canActivate: [permissionGuard],
        data: { permissions: O.AVAILABILITY_READ, pageTitle: 'Historial de Disponibilidad' },
        loadComponent: () =>
          import('./features/operations/availability/availability-history.component').then(
            (m) => m.AvailabilityHistoryComponent,
          ),
      },
      {
        path: 'operaciones/disponibilidad/importar',
        canActivate: [permissionGuard],
        data: { permissions: O.AVAILABILITY_CREATE, pageTitle: 'Importar Disponibilidad (Excel)' },
        loadComponent: () =>
          import('./features/operations/availability/availability-import.component').then(
            (m) => m.AvailabilityImportComponent,
          ),
      },
      // ── Operaciones: Registro de Fallas ──────────────────────────────────
      {
        path: 'operaciones/fallas',
        canActivate: [permissionGuard],
        data: { permissions: O.FAULT_REPORT_READ, pageTitle: 'Registro de Fallas' },
        loadComponent: () =>
          import('./features/operations/fault-reports/fault-report-list.component').then(
            (m) => m.FaultReportListComponent,
          ),
      },
      {
        path: 'operaciones/fallas/nuevo',
        canActivate: [permissionGuard],
        canDeactivate: [faultReportCanDeactivate],
        data: { permissions: O.FAULT_REPORT_CREATE, pageTitle: 'Registrar Falla' },
        loadComponent: () =>
          import('./features/operations/fault-reports/fault-report-form.component').then(
            (m) => m.FaultReportFormComponent,
          ),
      },
      // ── Mantenimiento (pautas PM) ─────────────────────────────────────────
      {
        path: 'kits',
        canActivate: [permissionGuard],
        data: { permissions: O.MAINTENANCE_READ, pageTitle: 'Kits de mantenimiento' },
        loadComponent: () =>
          import('./features/maintenance-kits/kit-list/kit-list.component').then(
            (m) => m.KitListComponent,
          ),
      },
      {
        path: 'kits/nuevo',
        canActivate: [permissionGuard],
        data: { permissions: O.MAINTENANCE_MANAGE, pageTitle: 'Nuevo kit PM' },
        loadComponent: () =>
          import('./features/maintenance-kits/kit-form/kit-form.component').then(
            (m) => m.KitFormComponent,
          ),
      },
      {
        path: 'kits/:id',
        canActivate: [permissionGuard],
        data: { permissions: O.MAINTENANCE_READ, pageTitle: 'Kit de mantenimiento' },
        loadComponent: () =>
          import('./features/maintenance-kits/kit-form/kit-form.component').then(
            (m) => m.KitFormComponent,
          ),
      },
      // ── Inventario — PBAC en permissionGuard ─────────────────────────────────
      {
        path: 'articulos',
        canActivate: [permissionGuard],
        data: { permissions: I.ITEM_READ, pageTitle: 'Catálogo Maestro de Artículos' },
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-list/inventory-item-list.component').then(
            (m) => m.InventoryItemListComponent,
          ),
      },
      {
        path: 'articulos/nuevo',
        canActivate: [permissionGuard],
        data: { permissions: I.ITEM_CREATE, pageTitle: 'Catálogo Maestro de Artículos' },
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-form/inventory-item-form.component').then(
            (m) => m.InventoryItemFormComponent,
          ),
      },
      {
        path: 'articulos/:id',
        canActivate: [permissionGuard],
        data: { permissions: I.ITEM_READ, pageTitle: 'Catálogo Maestro de Artículos' },
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-form/inventory-item-form.component').then(
            (m) => m.InventoryItemFormComponent,
          ),
      },
      {
        path: 'inventario/configuracion',
        canActivate: [permissionGuard],
        data: { permissions: I.CATEGORY_READ, pageTitle: 'Ajustes de inventario' },
        loadComponent: () =>
          import('./features/inventory-settings/inventory-settings.component').then(
            (m) => m.InventorySettingsComponent,
          ),
      },
      {
        path: 'inventario/bodegas',
        canActivate: [permissionGuard],
        data: { permissions: I.WAREHOUSE_READ, pageTitle: 'Gestión de Bodegas' },
        loadComponent: () =>
          import('./features/warehouses/warehouse-list/warehouse-list.component').then(
            (m) => m.WarehouseListComponent,
          ),
      },
      {
        path: 'inventario/bodegas/nueva',
        canActivate: [permissionGuard],
        data: { permissions: I.WAREHOUSE_MANAGE, pageTitle: 'Gestión de Bodegas' },
        loadComponent: () =>
          import('./features/warehouses/warehouse-form/warehouse-form.component').then(
            (m) => m.WarehouseFormComponent,
          ),
      },
      {
        path: 'inventario/bodegas/:id',
        canActivate: [permissionGuard],
        data: { permissions: I.WAREHOUSE_READ, pageTitle: 'Gestión de Bodegas' },
        loadComponent: () =>
          import('./features/warehouses/warehouse-form/warehouse-form.component').then(
            (m) => m.WarehouseFormComponent,
          ),
      },
      {
        path: 'inventario/transferencias',
        canActivate: [permissionGuard],
        data: { permissions: I.TRANSFER_READ, pageTitle: 'Transferencias entre Bodegas' },
        loadComponent: () =>
          import('./features/inventory-transfer/inventory-transfer.component').then(
            (m) => m.InventoryTransferComponent,
          ),
      },
      { path: 'bodegas', redirectTo: 'inventario/bodegas', pathMatch: 'full' },
      {
        path: 'bodegas/nueva',
        redirectTo: 'inventario/bodegas/nueva',
        pathMatch: 'full',
      },
      {
        path: 'bodegas/:id',
        redirectTo: 'inventario/bodegas/:id',
        pathMatch: 'prefix',
      },
      {
        path: 'inventario/stock',
        canActivate: [permissionGuard],
        data: { permissions: I.STOCK_READ, pageTitle: 'Control de Stock' },
        loadComponent: () =>
          import('./features/inventory-stock/stock-dashboard/stock-dashboard.component').then(
            (m) => m.StockDashboardComponent,
          ),
      },
      {
        path: 'inventario/importar',
        canActivate: [permissionGuard],
        data: {
          permissionsAny: [I.ITEM_UPDATE, I.STOCK_ADJUST],
          pageTitle: 'Importar ajustes de stock',
        },
        loadComponent: () =>
          import('./features/inventory-items/inventory-master-import/inventory-master-import.component').then(
            (m) => m.InventoryMasterImportComponent,
          ),
      },
      {
        path: 'inventario/reporte-maestro',
        canActivate: [permissionGuard],
        data: {
          permissions: I.ANALYTICS_REPORT,
          pageTitle: 'Reporte maestro de valorización',
        },
        loadComponent: () =>
          import('./features/inventory-stock/inventory-master-report/inventory-master-report.component').then(
            (m) => m.InventoryMasterReportComponent,
          ),
      },
      {
        path: 'stock',
        redirectTo: 'inventario/stock',
        pathMatch: 'full',
      },
      {
        path: 'inventario/valorizacion',
        canActivate: [permissionGuard],
        data: { permissions: I.STOCK_READ, pageTitle: 'Valorización de inventario' },
        loadComponent: () =>
          import('./features/inventory-stock/stock-dashboard/stock-dashboard.component').then(
            (m) => m.StockDashboardComponent,
          ),
      },
      {
        path: 'inventario/abastecimiento',
        canActivate: [permissionGuard],
        data: { permissions: I.STOCK_READ, pageTitle: 'Abastecimiento' },
        loadComponent: () =>
          import('./features/inventory-stock/supply-alerts/supply-alerts.component').then(
            (m) => m.SupplyAlertsComponent,
          ),
      },
      {
        path: 'inventario/registro-horas',
        redirectTo: 'flota/registro-horas',
        pathMatch: 'full',
      },
      // ── Compras (P2P) — PBAC en permissionGuard ─────────────────────────────
      {
        path: 'compras/proveedores',
        canActivate: [permissionGuard],
        data: { permissions: P.VENDOR_READ },
        loadComponent: () =>
          import('./features/purchases/vendor-list/vendor-list.component').then(
            (m) => m.VendorListComponent,
          ),
      },
      {
        path: 'compras/proveedores/nuevo',
        canActivate: [permissionGuard],
        data: { permissions: P.VENDOR_CREATE },
        loadComponent: () =>
          import('./features/purchases/vendor-form/vendor-form.component').then(
            (m) => m.VendorFormComponent,
          ),
      },
      {
        path: 'compras/proveedores/:id',
        canActivate: [permissionGuard],
        data: { permissionsAny: [P.VENDOR_READ, P.VENDOR_UPDATE] },
        loadComponent: () =>
          import('./features/purchases/vendor-form/vendor-form.component').then(
            (m) => m.VendorFormComponent,
          ),
      },
      {
        path: 'compras/requerimientos',
        canActivate: [permissionGuard],
        data: { permissions: P.REQUISITION_READ },
        loadComponent: () =>
          import('./features/purchases/requisition-list/requisition-list.component').then(
            (m) => m.RequisitionListComponent,
          ),
      },
      {
        path: 'compras/requerimientos/nuevo',
        canActivate: [permissionGuard],
        data: { permissions: P.REQUISITION_CREATE },
        loadComponent: () =>
          import('./features/purchases/requisition-form/requisition-form.component').then(
            (m) => m.RequisitionFormComponent,
          ),
      },
      {
        path: 'compras/requerimientos/:id/edit',
        canActivate: [permissionGuard],
        data: { permissionsAny: [...REQUISITION_EDIT_ANY] },
        loadComponent: () =>
          import('./features/purchases/requisition-form/requisition-form.component').then(
            (m) => m.RequisitionFormComponent,
          ),
      },
      {
        path: 'compras/requerimientos/:id',
        canActivate: [permissionGuard],
        data: { permissions: P.REQUISITION_READ },
        loadComponent: () =>
          import('./features/purchases/requisition-detail/requisition-detail.component').then(
            (m) => m.RequisitionDetailComponent,
          ),
      },
      {
        path: 'compras/analytics',
        canActivate: [permissionGuard],
        data: { permissions: P.ANALYTICS_READ },
        loadComponent: () =>
          import('./features/purchases/purchases-dashboard/purchases-dashboard.component').then(
            (m) => m.PurchasesDashboardComponent,
          ),
      },
      {
        path: 'compras/facturas',
        canActivate: [permissionGuard],
        data: { permissions: P.INVOICE_READ },
        loadComponent: () =>
          import('./features/purchases/purchase-invoice-list/purchase-invoice-list.component').then(
            (m) => m.PurchaseInvoiceListComponent,
          ),
      },
      {
        path: 'compras/calendario-pagos',
        canActivate: [permissionGuard],
        data: { permissions: P.INVOICE_READ },
        loadComponent: () =>
          import('./features/purchases/purchase-payment-calendar/purchase-payment-calendar.component').then(
            (m) => m.PurchasePaymentCalendarComponent,
          ),
      },
      {
        path: 'compras/ordenes',
        canActivate: [permissionGuard],
        data: { permissions: P.ORDER_READ },
        loadComponent: () =>
          import('./features/purchases/purchase-order-list/purchase-order-list.component').then(
            (m) => m.PurchaseOrderListComponent,
          ),
      },
      {
        path: 'compras/ordenes/:orderId/factura',
        canActivate: [permissionGuard],
        data: { permissionsAny: [P.INVOICE_CREATE, P.INVOICE_UPDATE] },
        loadComponent: () =>
          import('./features/purchases/purchase-invoice-form/purchase-invoice-form.component').then(
            (m) => m.PurchaseInvoiceFormComponent,
          ),
      },
      {
        path: 'compras/ordenes/:id',
        canActivate: [permissionGuard],
        data: { permissions: P.ORDER_READ },
        loadComponent: () =>
          import('./features/purchases/purchase-order-detail/purchase-order-detail.component').then(
            (m) => m.PurchaseOrderDetailComponent,
          ),
      },
      {
        path: 'compras/recepciones',
        canActivate: [permissionGuard],
        data: { permissions: P.RECEIPT_READ },
        loadComponent: () =>
          import('./features/purchases/receipt-list/receipt-list.component').then(
            (m) => m.ReceiptListComponent,
          ),
      },
      {
        path: 'compras/recepciones/nueva',
        canActivate: [permissionGuard],
        data: { permissions: P.RECEIPT_CREATE },
        loadComponent: () =>
          import('./features/purchases/receipt-create/receipt-create.component').then(
            (m) => m.ReceiptCreateComponent,
          ),
      },
      {
        path: 'compras/recepciones/:id',
        canActivate: [permissionGuard],
        data: { permissions: P.RECEIPT_READ },
        loadComponent: () =>
          import('./features/purchases/receipt-form/receipt-form.component').then(
            (m) => m.ReceiptFormComponent,
          ),
      },
      {
        path: 'compras/configuracion',
        canActivate: [permissionGuard],
        data: { permissions: P.SETTING_READ },
        loadComponent: () =>
          import('./features/purchases/purchase-settings/purchase-settings.component').then(
            (m) => m.PurchaseSettingsComponent,
          ),
      },
      // ── Configuración (ADMIN) ──────────────────────────────────────────────
      {
        path: 'catalogos',
        canActivate: [authGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () =>
          import('./features/settings/catalog-master/catalog-master.component').then(
            (m) => m.CatalogMasterComponent,
          ),
      },
      {
        path: 'configuracion/contratos',
        canActivate: [permissionGuard],
        data: {
          permissions: A.CONTRACT_READ,
          pageTitle: 'Maestro de Contratos',
        },
        loadComponent: () =>
          import('./features/settings/contract-master/contract-master.component').then(
            (m) => m.ContractMasterComponent,
          ),
      },
      {
        path: 'configuracion/empresa',
        canActivate: [permissionGuard],
        data: {
          permissions: A.TENANT_CONFIG_READ,
          pageTitle: 'Empresa',
        },
        loadComponent: () =>
          import('./features/settings/company-config/company-config.component').then(
            (m) => m.CompanyConfigComponent,
          ),
      },
      {
        path: 'configuracion/notificaciones',
        canActivate: [permissionGuard],
        data: {
          permissions: A.NOTIFICATION_READ,
          pageTitle: 'Gobernanza de Notificaciones',
        },
        loadComponent: () =>
          import('./features/settings/notification-governance/notification-governance.component').then(
            (m) => m.NotificationGovernanceComponent,
          ),
      },
      {
        path: 'configuracion/gobernanza-roles',
        canActivate: [permissionGuard],
        data: {
          permissions: A.USER_MANAGE_ROLES,
          pageTitle: 'Roles y Seguridad',
        },
        loadComponent: () =>
          import('./features/settings/role-governance/role-governance.component').then(
            (m) => m.RoleGovernanceComponent,
          ),
      },
      // ── Administración — PBAC ──────────────────────────────────────────────
      {
        path: 'usuarios',
        canActivate: [permissionGuard],
        data: { permissions: A.USER_READ, pageTitle: 'Gestión de Usuarios' },
        loadComponent: () =>
          import('./features/users/user-management/user-management.component').then(
            (m) => m.UserManagementComponent,
          ),
      },
      {
        path: 'roles',
        redirectTo: 'configuracion/gobernanza-roles',
        pathMatch: 'full',
      },
    ],
  },
  { path: '', redirectTo: 'app', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth/login' },
];
