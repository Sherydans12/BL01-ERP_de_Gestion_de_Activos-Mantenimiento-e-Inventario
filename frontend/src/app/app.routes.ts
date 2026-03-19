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
        path: 'usuarios',
        canActivate: [authGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () =>
          import('./features/users/user-management/user-management.component').then(
            (m) => m.UserManagementComponent,
          ),
      },
    ],
  },
  { path: '', redirectTo: 'app/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth/login' },
];
