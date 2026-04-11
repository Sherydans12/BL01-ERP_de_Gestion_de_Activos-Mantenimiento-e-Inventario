import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import { ReportService } from '../../../core/services/report/report.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { EquipmentDetailModalComponent } from '../../fleet/equipment-detail-modal/equipment-detail-modal.component';
import { ExportService } from '../../../core/services/export/export.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-work-order-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    ConfirmModalComponent,
    EquipmentDetailModalComponent,
  ],
  templateUrl: './work-order-list.component.html',
})
export class WorkOrderListComponent implements OnInit {
  private workOrdersService = inject(WorkOrdersService);
  private reportService = inject(ReportService);
  private fleetService = inject(FleetService);
  private notificationService = inject(NotificationService);
  private exportService = inject(ExportService);
  authService = inject(AuthService);
  private router = inject(Router);

  workOrders = signal<any[]>([]);
  fleet = signal<any[]>([]);
  showFilters = signal(false);
  stats = signal<any>(null);

  // Pagination & Filter values
  filterDateFrom = '';
  filterDateTo = '';
  filterEquipmentId = '';
  filterStatus = '';
  filterSearch = '';

  currentPage = signal(1);
  pageSize = signal(10);
  totalItems = signal(0);
  totalPages = signal(0);

  // Modal State
  selectedOtForClose = signal<string | null>(null);

  showEquipmentDetailModal = signal(false);
  selectedEquipmentIdForDetail = signal<string | null>(null);

  constructor() {
    effect(
      () => {
        // Al cambiar el contrato global, recarga la lista
        const contractId = this.authService.currentContractId();
        this.currentPage.set(1);
        this.loadWorkOrders();
        this.loadStats();
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit() {
    this.fleetService.getEquipments({ limit: 1000 }).subscribe({
      next: (res) => this.fleet.set(res.data),
    });
  }

  private loadStats() {
    this.workOrdersService.getStats().subscribe({
      next: (data) => this.stats.set(data),
      error: (err) => console.error('Error al cargar stats:', err),
    });
  }

  private loadWorkOrders() {
    const params: any = {
      page: this.currentPage(),
      limit: this.pageSize(),
    };

    if (this.filterDateFrom) params.dateFrom = this.filterDateFrom;
    if (this.filterDateTo) params.dateTo = this.filterDateTo;
    if (this.filterEquipmentId) params.equipmentId = this.filterEquipmentId;
    if (this.filterStatus) params.status = this.filterStatus;
    if (this.filterSearch) params.search = this.filterSearch;

    this.workOrdersService.getWorkOrdersFiltered(params).subscribe({
      next: (res: any) => {
        this.workOrders.set(res.data || res);
        if (res.total !== undefined) {
          this.totalItems.set(res.total);
          this.totalPages.set(Math.ceil(res.total / this.pageSize()));
        }
      },
      error: (err) => console.error('Error al cargar OTs:', err),
    });
  }

  applyFilters() {
    this.currentPage.set(1);
    this.loadWorkOrders();
  }

  clearFilters() {
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterEquipmentId = '';
    this.filterStatus = '';
    this.filterSearch = '';
    this.currentPage.set(1);
    this.loadWorkOrders();
  }

  changePage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.loadWorkOrders();
    }
  }

  otCategoryLabel(category: string): string {
    switch (category) {
      case 'PROGRAMADA':
        return 'Programadas';
      case 'NO_PROGRAMADA_CORRECTIVA':
        return 'No programadas Correctiva';
      case 'NO_PROGRAMADA_REACTIVA':
        return 'No programada Reactiva';
      default:
        return category;
    }
  }

  getStatusConfig(status: string): { label: string; css: string } {
    switch (status) {
      case 'OPEN':
        return {
          label: 'ABIERTA',
          css: 'bg-gray-500/10 text-muted border-gray-500/20',
        };
      case 'IN_PROGRESS':
        return {
          label: 'EN PROGRESO',
          css: 'bg-[#00E5FF]/10 text-[#00E5FF] border-[#00E5FF]/20',
        };
      case 'ON_HOLD':
        return {
          label: 'EN ESPERA',
          css: 'bg-warning/10 text-warning border-warning/20',
        };
      case 'CLOSED':
        return {
          label: 'CERRADA',
          css: 'bg-success/10 text-success border-success/20',
        };
      default:
        return {
          label: status,
          css: 'bg-surface text-muted border-border',
        };
    }
  }

  confirmCloseOt(id: string) {
    this.router.navigate(['/app/ots', id]);
    this.notificationService.info(
      'Revisa los repuestos y bodega antes de cerrar la OT.',
    );
  }

  changeStatus(id: string, newStatus: string) {
    this.workOrdersService.updateStatus(id, newStatus).subscribe({
      next: () => {
        this.notificationService.success(`Estado actualizado a ${newStatus}.`);
        this.loadWorkOrders();
        this.loadStats();
      },
      error: (err) => {
        console.error('Error al cambiar estado OT:', err);
      },
    });
  }

  openEquipmentDetailFromOt(ot: { equipmentId?: string; equipment?: { id?: string } }) {
    const id = ot.equipmentId ?? ot.equipment?.id;
    if (!id) {
      this.notificationService.warning('Esta OT no tiene equipo asociado.');
      return;
    }
    this.selectedEquipmentIdForDetail.set(id);
    this.showEquipmentDetailModal.set(true);
  }

  viewPdf(id: string) {
    this.workOrdersService.getWorkOrder(id).subscribe({
      next: (otData) => this.reportService.generateOTReport(otData),
      error: (err) => console.error('Error al generar PDF:', err),
    });
  }

  exportToExcel() {
    const data = this.workOrders();
    if (data.length === 0) {
      this.notificationService.warning('No hay datos para exportar.');
      return;
    }

    const headersMap = {
      correlative: 'N° OT',
      status: 'Estado',
      type: 'Tipo',
      category: 'Categoría',
      maintenanceType: 'Tipo Mantenimiento',
      initialMeter: 'Medidor Inicial', // <-- CAMBIADO
      finalMeter: 'Medidor Final', // <-- CAMBIADO
      description: 'Descripción',
      createdAt: 'Fecha Creación',
      closedAt: 'Fecha Cierre',
      equipment: 'Equipo (N° Interno)',
    };

    // Preprocesar data para aplanar objetos como equipment.internalId antes de exportar
    const flatData = data.map((ot) => ({
      ...ot,
      category: this.otCategoryLabel(ot.category),
      equipment: ot.equipment
        ? `${ot.equipment.internalId} — ${ot.equipment.brand} ${ot.equipment.model}`
        : 'N/A',
    }));

    this.exportService.exportToExcel(
      flatData,
      'Ordenes_de_Trabajo',
      headersMap,
    );
  }
}
