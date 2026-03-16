import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(
        (m) => m.LoginComponent,
      ),
  },
  {
    path: 'app',
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
    ],
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' },
];
