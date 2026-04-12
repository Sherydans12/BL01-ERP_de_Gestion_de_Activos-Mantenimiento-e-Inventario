import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { PurchasesService } from '../../../core/services/purchases/purchases.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { Contract, Subcontract } from '../../../core/models/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

@Component({
  selector: 'app-requisition-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './requisition-form.component.html',
})
export class RequisitionFormComponent implements OnInit {
  private purchasesService = inject(PurchasesService);
  private authService = inject(AuthService);
  private contractsService = inject(ContractsService);
  private notify = inject(NotificationService);
  private router = inject(Router);

  readonly UOM_PRESETS = [
    { value: 'UN', label: 'UN - Unidad' },
    { value: 'KG', label: 'KG - Kilogramo' },
    { value: 'L', label: 'L - Litro' },
    { value: 'M', label: 'M - Metro' },
    { value: 'M2', label: 'M\u00B2 - Metro cuadrado' },
    { value: 'M3', label: 'M\u00B3 - Metro c\u00FAbico' },
    { value: 'GL', label: 'GL - Global' },
    { value: 'SET', label: 'SET - Conjunto' },
    { value: 'HR', label: 'HR - Hora' },
    { value: 'DIA', label: 'D\u00CDA - D\u00EDa' },
  ];

  isSaving = signal(false);
  isLoadingContracts = signal(true);
  contracts = signal<Contract[]>([]);
  selectedContractId = signal('');
  selectedSubcontractId = signal('');
  description = signal('');
  justification = signal('');
  items = signal<Array<{ description: string; quantity: number; unitOfMeasure: string; estimatedCost: number | null }>>([
    { description: '', quantity: 1, unitOfMeasure: 'UN', estimatedCost: null },
  ]);

  availableSubcontracts = computed(() => {
    const cid = this.selectedContractId();
    if (!cid) return [];
    const contract = this.contracts().find(c => c.id === cid);
    return contract?.subcontracts?.filter(s => s.isActive) || [];
  });

  ngOnInit() {
    this.contractsService.findAll().subscribe({
      next: (all) => {
        const user = this.authService.currentUser();
        let list = all;
        if (user) {
          const seeAll =
            user.role === 'SUPER_ADMIN' ||
            user.role === 'ADMIN' ||
            user.allowedContracts?.includes('ALL');
          if (!seeAll) {
            list = all.filter((c) => user.allowedContracts?.includes(c.id));
          }
        }
        list = list.filter(
          (c) =>
            c.isActive !== false &&
            c.id !== 'none' &&
            c.id !== 'err',
        );
        this.contracts.set(list);

        const cid = this.authService.currentContractId();
        if (cid && cid !== 'ALL' && isUuid(cid) && list.some((c) => c.id === cid)) {
          this.selectedContractId.set(cid);
        } else if (list.length === 1) {
          this.selectedContractId.set(list[0].id);
        }

        this.isLoadingContracts.set(false);
      },
      error: () => {
        this.notify.error('Error al cargar contratos');
        this.isLoadingContracts.set(false);
      },
    });
  }

  onContractChange(value: string) {
    this.selectedContractId.set(value);
    this.selectedSubcontractId.set('');
  }

  cancel() {
    this.resetForm();
    this.router.navigate(['/app/compras/requerimientos']);
  }

  private resetForm() {
    this.description.set('');
    this.justification.set('');
    this.selectedSubcontractId.set('');
    this.items.set([{ description: '', quantity: 1, unitOfMeasure: 'UN', estimatedCost: null }]);
    const list = this.contracts();
    const cid = this.authService.currentContractId();
    if (cid && cid !== 'ALL' && isUuid(cid) && list.some((c) => c.id === cid)) {
      this.selectedContractId.set(cid);
    } else if (list.length === 1) {
      this.selectedContractId.set(list[0].id);
    } else {
      this.selectedContractId.set('');
    }
  }

  addItem() {
    this.items.update(items => [...items, { description: '', quantity: 1, unitOfMeasure: 'UN', estimatedCost: null }]);
  }

  removeItem(index: number) {
    this.items.update(items => items.filter((_, i) => i !== index));
  }

  updateItem(index: number, field: string, value: any) {
    this.items.update(items => items.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  save() {
    if (!this.description()) { this.notify.error('La descripci\u00F3n es obligatoria'); return; }
    if (this.items().some(i => !i.description)) { this.notify.error('Todos los \u00EDtems deben tener descripci\u00F3n'); return; }

    const contractId = this.selectedContractId();
    if (!contractId || !isUuid(contractId)) {
      this.notify.error('Seleccione un contrato para el requerimiento');
      return;
    }

    this.isSaving.set(true);
    this.purchasesService.createRequisition({
      contractId,
      subcontractId: this.selectedSubcontractId() || undefined,
      description: this.description(),
      justification: this.justification(),
      items: this.items(),
    }).subscribe({
      next: (req) => {
        this.notify.success(`Requerimiento ${req.correlative} creado`);
        this.router.navigate(['/app/compras/requerimientos', req.id]);
      },
      error: (err: any) => {
        this.notify.error(err?.error?.message || 'Error al crear requerimiento');
        this.isSaving.set(false);
      },
    });
  }
}
