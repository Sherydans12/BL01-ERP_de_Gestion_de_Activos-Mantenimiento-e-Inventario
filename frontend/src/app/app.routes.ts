import { Routes } from '@angular/router';
import { authGuard } from './core/services/auth/auth.guard';

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
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      // Futura ruta: { path: 'flota', component: FleetMasterComponent }
      // ── Operaciones ────────────────────────────────────────────────────────
      {
        path: 'flota',
        loadComponent: () =>
          import('./features/fleet/fleet-master/fleet-master.component').then(
            (m) => m.FleetMasterComponent,
          ),
      },
      {
        path: 'ots',
        loadComponent: () =>
          import('./features/work-orders/work-order-list/work-order-list.component').then(
            (m) => m.WorkOrderListComponent,
          ),
      },
      {
        path: 'ots/nueva',
        loadComponent: () =>
          import('./features/work-orders/work-order-form/work-order-form.component').then(
            (m) => m.WorkOrderFormComponent,
          ),
      },
      {
        path: 'ots/:id',
        loadComponent: () =>
          import('./features/work-orders/work-order-form/work-order-form.component').then(
            (m) => m.WorkOrderFormComponent,
          ),
      },
      /** Alias para deep links desde Kardex / documentación. */
      {
        path: 'mantenimiento/ot/:id',
        loadComponent: () =>
          import('./features/work-orders/work-order-form/work-order-form.component').then(
            (m) => m.WorkOrderFormComponent,
          ),
      },
      // ── Mantenimiento ──────────────────────────────────────────────────────
      {
        path: 'kits',
        canActivate: [authGuard],
        data: { roles: ['ADMIN', 'SUPERVISOR'] },
        loadComponent: () =>
          import('./features/maintenance-kits/kit-list/kit-list.component').then(
            (m) => m.KitListComponent,
          ),
      },
      {
        path: 'kits/nuevo',
        canActivate: [authGuard],
        data: { roles: ['ADMIN', 'SUPERVISOR'] },
        loadComponent: () =>
          import('./features/maintenance-kits/kit-form/kit-form.component').then(
            (m) => m.KitFormComponent,
          ),
      },
      {
        path: 'kits/:id',
        canActivate: [authGuard],
        data: { roles: ['ADMIN', 'SUPERVISOR'] },
        loadComponent: () =>
          import('./features/maintenance-kits/kit-form/kit-form.component').then(
            (m) => m.KitFormComponent,
          ),
      },
      // ── Inventario ─────────────────────────────────────────────────────────
      {
        path: 'articulos',
        canActivate: [authGuard],
        data: { roles: ['ADMIN', 'SUPERVISOR'], pageTitle: 'Catálogo Maestro de Artículos' },
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-list/inventory-item-list.component').then(
            (m) => m.InventoryItemListComponent,
          ),
      },
      {
        path: 'articulos/nuevo',
        canActivate: [authGuard],
        data: { roles: ['ADMIN', 'SUPERVISOR'], pageTitle: 'Catálogo Maestro de Artículos' },
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-form/inventory-item-form.component').then(
            (m) => m.InventoryItemFormComponent,
          ),
      },
      {
        path: 'articulos/:id',
        canActivate: [authGuard],
        data: { roles: ['ADMIN', 'SUPERVISOR'], pageTitle: 'Catálogo Maestro de Artículos' },
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-form/inventory-item-form.component').then(
            (m) => m.InventoryItemFormComponent,
          ),
      },
      {
        path: 'inventario/configuracion',
        canActivate: [authGuard],
        data: {
          roles: ['ADMIN', 'SUPERVISOR'],
          pageTitle: 'Ajustes de inventario',
        },
        loadComponent: () =>
          import('./features/inventory-settings/inventory-settings.component').then(
            (m) => m.InventorySettingsComponent,
          ),
      },
      {
        path: 'inventario/bodegas',
        canActivate: [authGuard],
        data: {
          roles: ['ADMIN', 'SUPERVISOR'],
          pageTitle: 'Gestión de Bodegas',
        },
        loadComponent: () =>
          import('./features/warehouses/warehouse-list/warehouse-list.component').then(
            (m) => m.WarehouseListComponent,
          ),
      },
      {
        path: 'inventario/bodegas/nueva',
        canActivate: [authGuard],
        data: {
          roles: ['ADMIN', 'SUPERVISOR'],
          pageTitle: 'Gestión de Bodegas',
        },
        loadComponent: () =>
          import('./features/warehouses/warehouse-form/warehouse-form.component').then(
            (m) => m.WarehouseFormComponent,
          ),
      },
      {
        path: 'inventario/bodegas/:id',
        canActivate: [authGuard],
        data: {
          roles: ['ADMIN', 'SUPERVISOR'],
          pageTitle: 'Gestión de Bodegas',
        },
        loadComponent: () =>
          import('./features/warehouses/warehouse-form/warehouse-form.component').then(
            (m) => m.WarehouseFormComponent,
          ),
      },
      {
        path: 'inventario/transferencias',
        canActivate: [authGuard],
        data: {
          roles: ['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'],
          pageTitle: 'Transferencias entre Bodegas',
        },
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
        loadComponent: () =>
          import('./features/inventory-stock/stock-dashboard/stock-dashboard.component').then(
            (m) => m.StockDashboardComponent,
          ),
        data: { pageTitle: 'Control de Stock' },
      },
      {
        path: 'stock',
        redirectTo: 'inventario/stock',
        pathMatch: 'full',
      },
      {
        path: 'inventario/valorizacion',
        canActivate: [authGuard],
        data: {
          roles: ['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'],
          pageTitle: 'Valorización de inventario',
        },
        loadComponent: () =>
          import('./features/inventory-stock/stock-dashboard/stock-dashboard.component').then(
            (m) => m.StockDashboardComponent,
          ),
      },
      {
        path: 'inventario/abastecimiento',
        loadComponent: () =>
          import('./features/inventory-stock/supply-alerts/supply-alerts.component').then(
            (m) => m.SupplyAlertsComponent,
          ),
        data: { pageTitle: 'Abastecimiento' },
      },
      // ── Compras (P2P) ──────────────────────────────────────────────────────
      {
        path: 'compras/proveedores',
        loadComponent: () =>
          import('./features/purchases/vendor-list/vendor-list.component').then(
            (m) => m.VendorListComponent,
          ),
      },
      {
        path: 'compras/proveedores/nuevo',
        loadComponent: () =>
          import('./features/purchases/vendor-form/vendor-form.component').then(
            (m) => m.VendorFormComponent,
          ),
      },
      {
        path: 'compras/proveedores/:id',
        loadComponent: () =>
          import('./features/purchases/vendor-form/vendor-form.component').then(
            (m) => m.VendorFormComponent,
          ),
      },
      {
        path: 'compras/requerimientos',
        loadComponent: () =>
          import('./features/purchases/requisition-list/requisition-list.component').then(
            (m) => m.RequisitionListComponent,
          ),
      },
      {
        path: 'compras/requerimientos/nuevo',
        loadComponent: () =>
          import('./features/purchases/requisition-form/requisition-form.component').then(
            (m) => m.RequisitionFormComponent,
          ),
      },
      {
        path: 'compras/requerimientos/:id/edit',
        loadComponent: () =>
          import('./features/purchases/requisition-form/requisition-form.component').then(
            (m) => m.RequisitionFormComponent,
          ),
      },
      {
        path: 'compras/requerimientos/:id',
        loadComponent: () =>
          import('./features/purchases/requisition-detail/requisition-detail.component').then(
            (m) => m.RequisitionDetailComponent,
          ),
      },
      {
        path: 'compras/analytics',
        canActivate: [authGuard],
        data: { roles: ['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./features/purchases/purchases-dashboard/purchases-dashboard.component').then(
            (m) => m.PurchasesDashboardComponent,
          ),
      },
      {
        path: 'compras/facturas',
        loadComponent: () =>
          import('./features/purchases/purchase-invoice-list/purchase-invoice-list.component').then(
            (m) => m.PurchaseInvoiceListComponent,
          ),
      },
      {
        path: 'compras/calendario-pagos',
        loadComponent: () =>
          import('./features/purchases/purchase-payment-calendar/purchase-payment-calendar.component').then(
            (m) => m.PurchasePaymentCalendarComponent,
          ),
      },
      {
        path: 'compras/ordenes',
        loadComponent: () =>
          import('./features/purchases/purchase-order-list/purchase-order-list.component').then(
            (m) => m.PurchaseOrderListComponent,
          ),
      },
      {
        path: 'compras/ordenes/:orderId/factura',
        loadComponent: () =>
          import('./features/purchases/purchase-invoice-form/purchase-invoice-form.component').then(
            (m) => m.PurchaseInvoiceFormComponent,
          ),
      },
      {
        path: 'compras/ordenes/:id',
        loadComponent: () =>
          import('./features/purchases/purchase-order-detail/purchase-order-detail.component').then(
            (m) => m.PurchaseOrderDetailComponent,
          ),
      },
      {
        path: 'compras/recepciones',
        loadComponent: () =>
          import('./features/purchases/receipt-list/receipt-list.component').then(
            (m) => m.ReceiptListComponent,
          ),
      },
      {
        path: 'compras/recepciones/nueva',
        loadComponent: () =>
          import('./features/purchases/receipt-create/receipt-create.component').then(
            (m) => m.ReceiptCreateComponent,
          ),
      },
      {
        path: 'compras/recepciones/:id',
        loadComponent: () =>
          import('./features/purchases/receipt-form/receipt-form.component').then(
            (m) => m.ReceiptFormComponent,
          ),
      },
      {
        path: 'compras/configuracion',
        canActivate: [authGuard],
        data: { roles: ['ADMIN', 'SUPER_ADMIN'] },
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
        canActivate: [authGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () =>
          import('./features/settings/contract-master/contract-master.component').then(
            (m) => m.ContractMasterComponent,
          ),
      },
      {
        path: 'configuracion/empresa',
        canActivate: [authGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () =>
          import('./features/settings/company-config/company-config.component').then(
            (m) => m.CompanyConfigComponent,
          ),
      },
      // ── Administración (ADMIN) ─────────────────────────────────────────────
      {
        path: 'usuarios',
        canActivate: [authGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () =>
          import('./features/users/user-management/user-management.component').then(
            (m) => m.UserManagementComponent,
          ),
      },
      {
        path: 'roles',
        canActivate: [authGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () =>
          import('./features/roles/roles.component').then(
            (m) => m.RolesComponent,
          ),
      },
    ],
  },
  { path: '', redirectTo: 'app/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth/login' },
];
