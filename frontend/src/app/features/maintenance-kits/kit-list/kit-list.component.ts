import { Component, inject, signal, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { MaintenanceKitsService } from '../../../core/services/maintenance-kits/maintenance-kits.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-kit-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './kit-list.component.html',
})
export class KitListComponent implements OnInit {
  private maintenanceKitsService = inject(MaintenanceKitsService);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);

  kits = signal<any[]>([]);

  constructor() {
    // REACTIVIDAD MULTIFAENA: Se dispara automáticamente si cambias el contrato arriba
    effect(() => {
      const currentContract = this.authService.currentContractId(); // Escuchamos el cambio
      this.loadKits(); // Disparamos la carga
    });
  }

  ngOnInit() {
    // La carga inicial ya está cubierta por el effect()
  }

  loadKits() {
    this.maintenanceKitsService.getKits().subscribe({
      next: (data) => this.kits.set(data),
      error: (err) => console.error('Error al cargar kits', err),
    });
  }

  deleteKit(id: string, code: string) {
    if (
      confirm(
        `¿Estás seguro de eliminar el Kit ${code}? Esta acción no se puede deshacer.`,
      )
    ) {
      this.maintenanceKitsService.deleteKit(id).subscribe({
        next: () => {
          this.notificationService.success('Kit eliminado exitosamente.');
          this.loadKits(); // Recargar lista
        },
        error: (err) => {
          console.error('Error eliminando kit', err);
          this.notificationService.error('Error al eliminar el Kit.');
        },
      });
    }
  }
}
