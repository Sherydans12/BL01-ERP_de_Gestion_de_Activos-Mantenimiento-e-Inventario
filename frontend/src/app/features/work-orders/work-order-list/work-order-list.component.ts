import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface WorkOrderSummary {
  id: string;
  correlative: string;
  date: string;
  equipmentInternalId: string;
  equipmentType: string;
  category: string;
  systems: string[];
  status: 'ABIERTA' | 'EN_REVISION' | 'CERRADA';
  hasBacklog: boolean;
}

@Component({
  selector: 'app-work-order-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './work-order-list.component.html',
})
export class WorkOrderListComponent {
  // Mock de OTs que vendrán del Backend
  workOrders = signal<WorkOrderSummary[]>([
    {
      id: 'ot-101',
      correlative: 'OT-2026-001',
      date: '2026-03-16',
      equipmentInternalId: 'EC-3005',
      equipmentType: 'CAMIONETA',
      category: 'PROGRAMADA (PM 250)',
      systems: ['MOTOR', 'TRANSMISIÓN'],
      status: 'EN_REVISION', // Lista para que el Jefe la cierre
      hasBacklog: false,
    },
    {
      id: 'ot-102',
      correlative: 'OT-2026-002',
      date: '2026-03-16',
      equipmentInternalId: 'EC-2995',
      equipmentType: 'BULLDOZER',
      category: 'FALLA',
      systems: ['HIDRÁULICO'],
      status: 'ABIERTA', // Mecánico trabajando
      hasBacklog: true,
    },
    {
      id: 'ot-100',
      correlative: 'OT-2026-000',
      date: '2026-03-15',
      equipmentInternalId: 'EC-3045',
      equipmentType: 'CAMIÓN ALJIBE',
      category: 'PROGRAMADA',
      systems: ['FRENOS'],
      status: 'CERRADA',
      hasBacklog: false,
    },
  ]);

  // UI Helpers para los badges de estado
  getStatusConfig(status: string): { label: string; css: string } {
    switch (status) {
      case 'ABIERTA':
        return {
          label: 'EN PROGRESO',
          css: 'bg-primary/10 text-primary border-primary/20',
        };
      case 'EN_REVISION':
        return {
          label: 'POR REVISAR',
          css: 'bg-warning/10 text-warning border-warning/20',
        };
      case 'CERRADA':
        return {
          label: 'CERRADA',
          css: 'bg-success/10 text-success border-success/20',
        };
      default:
        return { label: status, css: 'bg-gray-800 text-gray-300' };
    }
  }

  // Simulación de acción del Jefe de Taller
  approveWorkOrder(id: string) {
    if (confirm('¿Estás seguro de cerrar esta Orden de Trabajo?')) {
      this.workOrders.update((ots) =>
        ots.map((ot) => (ot.id === id ? { ...ot, status: 'CERRADA' } : ot)),
      );
    }
  }
}
