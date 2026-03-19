import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WorkOrdersService } from '../../core/services/work-orders/work-orders.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private workOrdersService = inject(WorkOrdersService);

  stats = signal<any>(null);
  lastUpdated = signal<Date>(new Date());

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
}
