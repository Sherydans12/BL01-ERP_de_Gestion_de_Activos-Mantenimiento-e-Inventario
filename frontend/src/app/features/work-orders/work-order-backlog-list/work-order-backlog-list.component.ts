import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  WorkOrdersService,
  BacklogItemDto,
} from '../../../core/services/work-orders/work-orders.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { O } from '../../../core/constants/operations-permissions';

@Component({
  selector: 'app-work-order-backlog-list',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, HasPermissionDirective],
  templateUrl: './work-order-backlog-list.component.html',
})
export class WorkOrderBacklogListComponent implements OnInit {
  protected readonly o = O;

  private workOrdersService = inject(WorkOrdersService);
  private notification = inject(NotificationService);

  items = signal<BacklogItemDto[]>([]);
  total = signal(0);
  filter = signal<'ALL' | 'PENDING' | 'DONE'>('PENDING');
  loading = signal(true);

  pageSize = signal(25);
  page = signal(1);
  searchDraft = signal('');
  searchApplied = signal('');

  readonly filterOptions: { k: 'ALL' | 'PENDING' | 'DONE'; l: string }[] = [
    { k: 'PENDING', l: 'Pendientes' },
    { k: 'DONE', l: 'Realizados' },
    { k: 'ALL', l: 'Todos' },
  ];

  totalPages = () =>
    Math.max(1, Math.ceil(this.total() / this.pageSize()));

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    const st =
      this.filter() === 'ALL'
        ? undefined
        : (this.filter() as 'PENDING' | 'DONE');
    const offset = (this.page() - 1) * this.pageSize();
    this.workOrdersService
      .listBacklog({
        status: st,
        limit: this.pageSize(),
        offset,
        search: this.searchApplied() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.items.set(res.data);
          this.total.set(res.total);
          this.loading.set(false);
        },
        error: () => {
          this.items.set([]);
          this.total.set(0);
          this.loading.set(false);
          this.notification.error('No se pudo cargar el backlog');
        },
      });
  }

  setFilter(f: 'ALL' | 'PENDING' | 'DONE') {
    this.filter.set(f);
    this.page.set(1);
    this.load();
  }

  applySearch() {
    this.searchApplied.set(this.searchDraft().trim());
    this.page.set(1);
    this.load();
  }

  clearSearch() {
    this.searchDraft.set('');
    this.searchApplied.set('');
    this.page.set(1);
    this.load();
  }

  prevPage() {
    if (this.page() > 1) {
      this.page.update((p) => p - 1);
      this.load();
    }
  }

  nextPage() {
    if (this.page() < this.totalPages()) {
      this.page.update((p) => p + 1);
      this.load();
    }
  }

  toggle(item: BacklogItemDto) {
    if (!item.workOrder?.id) return;
    const next = item.status === 'DONE' ? 'PENDING' : 'DONE';
    this.workOrdersService
      .patchBacklogItem(item.workOrder.id, item.id, next)
      .subscribe({
        next: (updated) => {
          this.items.update((list) =>
            list.map((r) =>
              r.id === item.id ? { ...r, status: updated.status } : r,
            ),
          );
        },
        error: () => this.notification.error('No se pudo actualizar'),
      });
  }
}
