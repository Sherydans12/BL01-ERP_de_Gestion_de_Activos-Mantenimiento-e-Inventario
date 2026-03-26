import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { Contract, Subcontract } from '../../../core/models/types';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-contract-master',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmModalComponent],
  templateUrl: './contract-master.component.html',
  styleUrls: ['./contract-master.component.scss'],
})
export class ContractMasterComponent implements OnInit {
  contracts = signal<Contract[]>([]);

  // Modales
  isContractModalOpen = signal(false);
  isSubcontractModalOpen = signal(false);
  isDeleteModalOpen = signal(false);
  itemToDelete = signal<{
    id: string;
    type: 'contract' | 'subcontract';
    name: string;
  } | null>(null);

  // Elementos en edición
  editingContract = signal<Contract | null>(null);
  editingSubcontract = signal<Subcontract | null>(null);
  selectedContractIdForSub = signal<string | null>(null);

  // Formularios
  contractFormData = signal({ name: '', code: '', isActive: true });
  subcontractFormData = signal({ name: '', code: '', isActive: true });

  constructor(
    private contractsService: ContractsService,
    private http: HttpClient, // Necesario temporalmente para peticiones directas a Subcontratos si no tienes un SubcontractsService
    private notification: NotificationService,
  ) {}

  ngOnInit() {
    this.loadContracts();
  }

  loadContracts() {
    this.contractsService.findAll().subscribe({
      next: (data) => this.contracts.set(data),
      error: (err) => console.error('Error loadContracts', err),
    });
  }

  // --- LÓGICA DE CONTRATOS ---

  openContractModal(contract?: Contract) {
    if (contract) {
      this.editingContract.set(contract);
      this.contractFormData.set({
        name: contract.name,
        code: contract.code,
        isActive: contract.isActive,
      });
    } else {
      this.editingContract.set(null);
      this.contractFormData.set({ name: '', code: '', isActive: true });
    }
    this.isContractModalOpen.set(true);
  }

  closeContractModal() {
    this.isContractModalOpen.set(false);
    this.editingContract.set(null);
  }

  saveContract() {
    const data = this.contractFormData();
    if (!data.name || !data.code)
      return this.notification.warning('Completa todos los campos');

    const editing = this.editingContract();
    if (editing) {
      this.contractsService.update(editing.id, data).subscribe({
        next: () => {
          this.notification.success('Contrato actualizado');
          this.loadContracts();
          this.closeContractModal();
        },
        error: (err) =>
          this.notification.error(err.error?.message || 'Error al actualizar'),
      });
    } else {
      this.contractsService.create(data).subscribe({
        next: () => {
          this.notification.success('Contrato creado');
          this.loadContracts();
          this.closeContractModal();
        },
        error: (err) =>
          this.notification.error(err.error?.message || 'Error al crear'),
      });
    }
  }

  deleteContract(id: string, name: string) {
    this.itemToDelete.set({ id, type: 'contract', name });
    this.isDeleteModalOpen.set(true);
  }

  // --- LÓGICA DE SUBCONTRATOS ---

  openSubcontractModal(contractId: string, subcontract?: Subcontract) {
    this.selectedContractIdForSub.set(contractId);

    if (subcontract) {
      this.editingSubcontract.set(subcontract);
      this.subcontractFormData.set({
        name: subcontract.name,
        code: subcontract.code,
        isActive: subcontract.isActive,
      });
    } else {
      this.editingSubcontract.set(null);
      this.subcontractFormData.set({ name: '', code: '', isActive: true });
    }
    this.isSubcontractModalOpen.set(true);
  }

  closeSubcontractModal() {
    this.isSubcontractModalOpen.set(false);
    this.editingSubcontract.set(null);
    this.selectedContractIdForSub.set(null);
  }

  saveSubcontract() {
    const data = this.subcontractFormData();
    const contractId = this.selectedContractIdForSub();

    if (!data.name || !data.code || !contractId)
      return this.notification.warning('Completa todos los campos');

    const editing = this.editingSubcontract();
    const url = `${environment.apiUrl}/subcontracts`;

    if (editing) {
      this.http.put(`${url}/${editing.id}`, data).subscribe({
        next: () => {
          this.notification.success('Subcontrato actualizado');
          this.loadContracts();
          this.closeSubcontractModal();
        },
        error: (err) =>
          this.notification.error(
            err.error?.message || 'Error al actualizar subcontrato',
          ),
      });
    } else {
      this.http.post(url, { ...data, contractId }).subscribe({
        next: () => {
          this.notification.success('Subcontrato creado');
          this.loadContracts();
          this.closeSubcontractModal();
        },
        error: (err) =>
          this.notification.error(
            err.error?.message || 'Error al crear subcontrato',
          ),
      });
    }
  }

  deleteSubcontract(id: string, name: string) {
    this.itemToDelete.set({ id, type: 'subcontract', name });
    this.isDeleteModalOpen.set(true);
  }

  confirmDelete() {
    const item = this.itemToDelete();
    if (!item) return;

    if (item.type === 'contract') {
      this.contractsService.remove(item.id).subscribe({
        next: () => {
          this.notification.success('Contrato eliminado exitosamente');
          this.loadContracts();
          this.cancelDelete();
        },
        error: (err) => {
          this.notification.error(
            err.error?.message || 'Error al eliminar contrato',
          );
          this.cancelDelete();
        },
      });
    } else if (item.type === 'subcontract') {
      this.http
        .delete(`${environment.apiUrl}/subcontracts/${item.id}`)
        .subscribe({
          next: () => {
            this.notification.success('Subcontrato eliminado exitosamente');
            this.loadContracts();
            this.cancelDelete();
          },
          error: (err) => {
            this.notification.error(
              err.error?.message || 'Error al eliminar subcontrato',
            );
            this.cancelDelete();
          },
        });
    }
  }

  cancelDelete() {
    this.isDeleteModalOpen.set(false);
    this.itemToDelete.set(null);
  }

  getDeleteMessage(): string {
    const item = this.itemToDelete();
    if (!item) return '';
    if (item.type === 'contract') {
      return `¿Estás seguro de eliminar el contrato principal "${item.name}"? Se eliminarán también todos sus subcontratos asociados. Esta acción no se puede deshacer.`;
    }
    return `¿Estás seguro de eliminar el subcontrato "${item.name}"? Asegúrate de que no tenga activos (equipos) vinculados. Esta acción no se puede deshacer.`;
  }
}
