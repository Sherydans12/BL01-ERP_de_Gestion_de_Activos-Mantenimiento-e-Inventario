import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  PurchasesService,
  PurchaseInvoice,
  PurchasePaymentCalendarDay,
} from '../../../core/services/purchases/purchases.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { Contract } from '../../../core/models/types';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { AuthService } from '../../../core/services/auth/auth.service';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';
import { FinancialClpPipe } from '../../../shared/pipes/financial-clp.pipe';

@Component({
  selector: 'app-purchase-payment-calendar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ClpCurrencyPipe,
    FinancialClpPipe,
    EntityLinkComponent,
    PurchasesPushNoticeComponent,
  ],
  templateUrl: './purchase-payment-calendar.component.html',
})
export class PurchasePaymentCalendarComponent implements OnInit {
  private purchasesService = inject(PurchasesService);
  private contractsService = inject(ContractsService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);

  contracts = signal<Contract[]>([]);
  contractId = signal('');
  /** Año (ej. 2026) y mes 0–11 */
  viewYear = signal(new Date().getUTCFullYear());
  viewMonth = signal(new Date().getUTCMonth());

  calendarRows = signal<PurchasePaymentCalendarDay[]>([]);
  dayMap = computed(() => {
    const m = new Map<string, PurchasePaymentCalendarDay>();
    for (const d of this.calendarRows()) {
      m.set(d.date, d);
    }
    return m;
  });

  isLoading = signal(false);
  selectedDateKey = signal<string | null>(null);
  dayInvoices = signal<PurchaseInvoice[]>([]);
  dayInvoicesLoading = signal(false);

  weekdayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  monthTitle = computed(() => {
    const y = this.viewYear();
    const mo = this.viewMonth();
    return new Intl.DateTimeFormat('es-CL', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, mo, 1)));
  });

  /** Celdas del mes (huecos + días), estable para el template. */
  monthCells = computed(() => {
    const y = this.viewYear();
    const mo = this.viewMonth();
    const first = new Date(Date.UTC(y, mo, 1));
    const lastDate = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const dow = first.getUTCDay();
    const mondayOffset = (dow + 6) % 7;

    const cells: { dateKey: string | null; inMonth: boolean }[] = [];
    for (let i = 0; i < mondayOffset; i++) {
      cells.push({ dateKey: null, inMonth: false });
    }
    for (let d = 1; d <= lastDate; d++) {
      const dateKey = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateKey, inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateKey: null, inMonth: false });
    }
    return cells;
  });

  /** Clave estable para @for del grid (evita bug del compilador con `dateKey ?? $index` en track). */
  trackMonthCell(
    index: number,
    cell: { dateKey: string | null; inMonth: boolean },
  ): string {
    return (
      cell.dateKey ?? `pad-${this.viewYear()}-${this.viewMonth()}-${index}`
    );
  }

  selectedDateLabel = computed(() => {
    const k = this.selectedDateKey();
    if (!k) return '';
    const [y, m, d] = k.split('-').map(Number);
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  });

  ngOnInit() {
    const q = this.route.snapshot.queryParamMap.get('contractId');
    if (q?.trim()) {
      this.contractId.set(q.trim());
    } else {
      const g = this.authService.currentContractId();
      if (g && g !== 'ALL') {
        this.contractId.set(g);
      }
    }
    if (this.contractId().trim()) {
      this.syncContractQuery();
    }

    this.route.queryParamMap.subscribe((p) => {
      const cid = p.get('contractId')?.trim();
      if (cid) {
        this.contractId.set(cid);
      }
      this.loadCalendar();
    });

    this.contractsService.findAll().subscribe({
      next: (c) => {
        this.contracts.set(c);
        if (!this.contractId().trim() && c.length === 1) {
          this.contractId.set(c[0].id);
          this.syncContractQuery();
        }
        this.loadCalendar();
      },
      error: () => {
        this.contracts.set([]);
        this.loadCalendar();
      },
    });
  }

  /** Mantiene ?contractId= alineado al filtro (compartir URL / recarga). */
  private syncContractQuery() {
    const cid = this.contractId().trim();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: cid ? { contractId: cid } : { contractId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  prevMonth() {
    let y = this.viewYear();
    let m = this.viewMonth();
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    this.viewYear.set(y);
    this.viewMonth.set(m);
    this.loadCalendar();
  }

  nextMonth() {
    let y = this.viewYear();
    let m = this.viewMonth();
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    this.viewYear.set(y);
    this.viewMonth.set(m);
    this.loadCalendar();
  }

  onContractSelect(value: string) {
    this.contractId.set(value);
    this.syncContractQuery();
    this.loadCalendar();
  }

  loadCalendar() {
    const cid = this.contractId().trim();
    if (!cid) {
      this.calendarRows.set([]);
      return;
    }
    const y = this.viewYear();
    const mo = this.viewMonth();
    const from = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
    const lastD = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const to = `${y}-${String(mo + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;

    this.isLoading.set(true);
    this.purchasesService
      .getPaymentCalendar({ from, to, contractId: cid })
      .subscribe({
        next: (rows) => {
          this.calendarRows.set(rows);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err
              ? (err as { error?: { message?: string } }).error?.message
              : undefined;
          this.notify.error(
            typeof msg === 'string' ? msg : 'Error al cargar calendario',
          );
          this.isLoading.set(false);
        },
      });
  }

  dayAgg(dateKey: string | null): PurchasePaymentCalendarDay | undefined {
    if (!dateKey) return undefined;
    return this.dayMap().get(dateKey);
  }

  badgeTotal(day: PurchasePaymentCalendarDay | undefined): number {
    if (!day) return 0;
    const p = day.pendingTotal ?? 0;
    return day.matchedTotal + day.discrepancyTotal + p;
  }

  tone(day: PurchasePaymentCalendarDay | undefined): 'none' | 'ok' | 'risk' | 'pending' | 'mixed' {
    if (!day) return 'none';
    if (this.badgeTotal(day) <= 0) return 'none';
    if ((day.discrepancyCount ?? 0) > 0) return 'risk';
    const p = day.pendingTotal ?? 0;
    const m = day.matchedTotal ?? 0;
    if (p > 0 && m > 0) return 'mixed';
    if ((day.matchedCount ?? 0) > 0 || m > 0) return 'ok';
    if ((day.pendingCount ?? 0) > 0 || p > 0) return 'pending';
    return 'none';
  }

  /** Borde del día: discrepancia sólida roja; solo pendiente punteado ámbar; conciliado borde verde; mixto punteado. */
  calendarCellFrameClass(day: PurchasePaymentCalendarDay | undefined): string {
    if (!day || this.badgeTotal(day) <= 0) return '';
    if ((day.discrepancyCount ?? 0) > 0) {
      return 'border border-red-500/45';
    }
    const p = day.pendingTotal ?? 0;
    const m = day.matchedTotal ?? 0;
    if (p > 0 && m > 0) {
      return 'border-2 border-dashed border-amber-500/45';
    }
    if (p > 0) {
      return 'border-2 border-dashed border-amber-500/55';
    }
    return 'border border-emerald-500/35';
  }

  openDay(dateKey: string | null) {
    if (!dateKey) return;
    const agg = this.dayAgg(dateKey);
    if (!agg || this.badgeTotal(agg) <= 0) return;
    this.selectedDateKey.set(dateKey);
    this.loadDayInvoices(dateKey);
  }

  closePanel() {
    this.selectedDateKey.set(null);
    this.dayInvoices.set([]);
  }

  private loadDayInvoices(dateKey: string) {
    const cid = this.contractId().trim();
    if (!cid) return;
    this.dayInvoicesLoading.set(true);
    this.purchasesService
      .listPurchaseInvoices({
        contractId: cid,
        dueDateFrom: dateKey,
        dueDateTo: dateKey,
      })
      .subscribe({
        next: (list) => {
          const filtered = list.filter(
            (inv) =>
              ['PENDING', 'MATCHED', 'DISCREPANCY'].includes(inv.status) &&
              this.effectiveDueDateKey(inv) === dateKey,
          );
          this.dayInvoices.set(filtered);
          this.dayInvoicesLoading.set(false);
        },
        error: () => {
          this.dayInvoices.set([]);
          this.dayInvoicesLoading.set(false);
          this.notify.error('No se pudieron cargar las facturas del día');
        },
      });
  }

  /** Vencimiento para agrupar en calendario: fecha explícita o emisión + 30 días (UTC). */
  private effectiveDueDateKey(inv: PurchaseInvoice): string {
    const due = inv.dueDate?.trim();
    if (due) return due.slice(0, 10);
    const em = inv.emissionDate?.trim();
    if (!em) return '';
    const base = new Date(em.includes('T') ? em : `${em.slice(0, 10)}T12:00:00.000Z`);
    if (Number.isNaN(base.getTime())) return '';
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  }

  statusLabels: Record<string, string> = {
    PENDING: 'Pendiente conciliación',
    MATCHED: 'Conciliada',
    DISCREPANCY: 'Discrepancia',
  };
}
