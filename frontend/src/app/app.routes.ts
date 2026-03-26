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
      {
        path: 'flota',
        loadComponent: () =>
          import('./features/fleet/fleet-master/fleet-master.component').then(
            (m) => m.FleetMasterComponent,
          ),
      },
      {
        path: 'catalogos',
        loadComponent: () =>
          import('./features/settings/catalog-master/catalog-master.component').then(
            (m) => m.CatalogMasterComponent,
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
      {
        path: 'usuarios',
        canActivate: [authGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () =>
          import('./features/users/user-management/user-management.component').then(
            (m) => m.UserManagementComponent,
          ),
      },
      // Mantenimiento - Pautas y Kits
      {
        path: 'kits',
        loadComponent: () =>
          import('./features/maintenance-kits/kit-list/kit-list.component').then(
            (m) => m.KitListComponent,
          ),
      },
      {
        path: 'kits/nuevo',
        loadComponent: () =>
          import('./features/maintenance-kits/kit-form/kit-form.component').then(
            (m) => m.KitFormComponent,
          ),
      },
      {
        path: 'kits/:id',
        loadComponent: () =>
          import('./features/maintenance-kits/kit-form/kit-form.component').then(
            (m) => m.KitFormComponent,
          ),
      },
      // Módulo de Inventario (Fase C)
      {
        path: 'articulos',
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-list/inventory-item-list.component').then(
            (m) => m.InventoryItemListComponent,
          ),
      },
      {
        path: 'articulos/nuevo',
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-form/inventory-item-form.component').then(
            (m) => m.InventoryItemFormComponent,
          ),
      },
      {
        path: 'articulos/:id',
        loadComponent: () =>
          import('./features/inventory-items/inventory-item-form/inventory-item-form.component').then(
            (m) => m.InventoryItemFormComponent,
          ),
      },
      // Módulo de Bodegas
      {
        path: 'bodegas',
        loadComponent: () =>
          import('./features/warehouses/warehouse-list/warehouse-list.component').then(
            (m) => m.WarehouseListComponent,
          ),
      },
      {
        path: 'bodegas/nueva',
        loadComponent: () =>
          import('./features/warehouses/warehouse-form/warehouse-form.component').then(
            (m) => m.WarehouseFormComponent,
          ),
      },
      {
        path: 'bodegas/:id',
        loadComponent: () =>
          import('./features/warehouses/warehouse-form/warehouse-form.component').then(
            (m) => m.WarehouseFormComponent,
          ),
      },
      {
        path: 'stock',
        loadComponent: () =>
          import('./features/inventory-stock/stock-dashboard/stock-dashboard.component').then(
            (m) => m.StockDashboardComponent,
          ),
      },
    ],
  },
  { path: '', redirectTo: 'app/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth/login' },
];
