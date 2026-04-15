import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WorkOrdersService } from '../../core/services/work-orders/work-orders.service';
import { EquipmentDetailModalComponent } from '../fleet/equipment-detail-modal/equipment-detail-modal.component';
import { WorkOrderDetailModalComponent } from '../work-orders/work-order-detail-modal/work-order-detail-modal.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    EquipmentDetailModalComponent,
    WorkOrderDetailModalComponent,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private workOrdersService = inject(WorkOrdersService);

  stats = signal<any>(null);
  lastUpdated = signal<Date>(new Date());

  showEquipmentDetail = signal(false);
  detailEquipmentId = signal<string | null>(null);

  showOtDetail = signal(false);
  detailOtId = signal<string | null>(null);

  ngOnInit() {
    this.loadStats();
  }

  loadStats() {
    this.workOrdersService.getStats().subscribe({
      next: (data) => {
        this.stats.set(data);
        this.lastUpdated.set(new Date());
      },
      error: (err) => console.error('Error al cargar stats:', err),
    });
  }

  openAlertEquipment(alert: { id: string }) {
    this.detailEquipmentId.set(alert.id);
    this.showEquipmentDetail.set(true);
  }

  closeEquipmentDetail() {
    this.showEquipmentDetail.set(false);
    this.detailEquipmentId.set(null);
  }

  openRecentOt(ot: { id: string }) {
    this.detailOtId.set(ot.id);
    this.showOtDetail.set(true);
  }

  closeOtDetail() {
    this.showOtDetail.set(false);
    this.detailOtId.set(null);
  }
}
