import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { CatalogService } from '../../../core/services/catalog/catalog.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { EquipmentDetailModalComponent } from '../equipment-detail-modal/equipment-detail-modal.component';
import { ExportService } from '../../../core/services/export/export.service';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs/operators';
import { PdfService } from '../../../core/services/pdf/pdf.service';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';

// IMPORTAMOS LAS INTERFACES GLOBALES (Mirroring del Schema)
import { Equipment, MeterType, Contract } from '../../../core/models/types';

@Component({
  selector: 'app-fleet-master',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    ConfirmModalComponent,
    EquipmentDetailModalComponent,
  ],
  templateUrl: './fleet-master.component.html',
  styles: [
    `
      :host dialog.equipment-register-dialog {
        box-sizing: border-box;
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        margin: 0;
      }
    `,
  ],
})
export class FleetMasterComponent implements OnInit {
  private injector = inject(Injector);
  private fb = inject(FormBuilder);
  private catalogService = inject(CatalogService);
  private fleetService = inject(FleetService);
  private contractsService = inject(ContractsService);
  private notificationService = inject(NotificationService);
  private exportService = inject(ExportService);
  private pdfService = inject(PdfService);
  private workOrdersService = inject(WorkOrdersService);
  authService = inject(AuthService);

  // Catálogos
  equipmentTypes = this.catalogService.equipmentTypes;
  brands = this.catalogService.brands;
  fuelTypes = this.catalogService.fuelTypes;
  driveTypes = this.catalogService.driveTypes;
  ownerships = this.catalogService.ownerships;

  // Exponemos el enum a la vista
  MeterType = MeterType;
  meterTypesArray = Object.values(MeterType);

  fleet = signal<Equipment[]>([]);
  contracts = signal<Contract[]>([]); // Para el select de Subcontratos

  // States Pagination & Filters
  currentPage = signal(1);
  pageSize = signal(10);
  totalItems = signal(0);
  totalPages = computed(() => Math.ceil(this.totalItems() / this.pageSize()));

  searchQuery = signal('');
  filterType = signal('');
  filterBrand = signal('');

  hasDuplicateError = signal(false);
  isDownloadingPdf = signal<string | null>(null);

  // Modal Confirmación
  showConfirmModal = signal(false);
  pendingDeleteId = signal<string | null>(null);

  // Modal Detalle del Activo
  showDetailModal = signal(false);
  selectedEquipmentId = signal<string | null>(null);

  // Señal derivada para filtrar subcontratos dinámicamente según el contrato seleccionado
  selectedContractId = signal<string>('');
  filteredSubcontracts = computed(() => {
    const cId = this.selectedContractId();
    const contract = this.contracts().find((c) => c.id === cId);
    return contract?.subcontracts || [];
  });

  // Subjects for debounce
  private searchSubject = new Subject<string>();

  showModal = false;
  isEditMode = false;
  currentEditId: string | null = null;

  equipmentDialog = viewChild<ElementRef<HTMLDialogElement>>('equipmentDialog');

  equipmentForm: FormGroup = this.fb.group({
    // Asignación Contractual Dinámica
    contractId: ['', [Validators.required]],
    subcontractId: [''], // Vacío o UUID; sin subcontratos en contrato → null en API

    // Identificación Base
    mineInternalId: [''],
    internalId: ['', [Validators.required]],
    plate: [''],
    type: ['', [Validators.required]],
    brand: ['', [Validators.required]],
    model: ['', [Validators.required]],

    // Lógica de Medición
    meterType: [MeterType.HOURS, [Validators.required]],
    currentMeter: [0, [Validators.required, Validators.min(0)]],

    // Identificación Extendida
    vin: [''],
    engineNumber: [''],
    year: [null],

    // Operación y Mantenimiento
    fuelType: [null],
    driveType: [null],
    ownership: [null],
    maintenanceFrequency: [null],

    // Último Mantenimiento
    lastMaintenanceDate: [''],
    lastMaintenanceMeter: [null],
    lastMaintenanceType: [''],

    // Documentación Legal
    techReviewExp: [''],
    circPermitExp: [''],
    soapExp: [''],
    mechanicalCertExp: [''],
    liabilityPolicyExp: [''],
  });

  constructor() {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((query) => {
        this.searchQuery.set(query);
        this.currentPage.set(1);
        this.loadFleet();
      });

    effect(
      () => {
        const contractId = this.authService.currentContractId();
        this.currentPage.set(1);
        this.loadFleet();
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit() {
    this.loadContracts();

    // Escuchar cambios en el selector de Contrato para limpiar el Subcontrato
    this.equipmentForm.get('contractId')?.valueChanges.subscribe((val) => {
      this.selectedContractId.set(val || '');
      // Si cambia el contrato y no estamos en modo edición inicializando datos, reseteamos el subcontrato
      if (!this.isEditMode) {
        this.equipmentForm.get('subcontractId')?.setValue('');
      }
    });
  }

  loadContracts() {
    this.contractsService.findAll().subscribe({
      next: (res) => this.contracts.set(res),
      error: (err) => console.error('Error al cargar contratos', err),
    });
  }

  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchSubject.next(value);
  }

  onFilterChange() {
    this.currentPage.set(1);
    this.loadFleet();
  }

  loadFleet() {
    const params = {
      page: this.currentPage(),
      limit: this.pageSize(),
      search: this.searchQuery() || undefined,
      type: this.filterType() || undefined,
      brand: this.filterBrand() || undefined,
    };

    this.fleetService.getEquipments(params).subscribe({
      next: (res) => {
        this.fleet.set(res.data);
        this.totalItems.set(res.total);
      },
      error: (err) => console.error('Error al cargar la flota', err),
    });
  }

  nextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((p) => p + 1);
      this.loadFleet();
    }
  }

  prevPage() {
    if (this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
      this.loadFleet();
    }
  }

  getDocStatus(expirationDate: string | null | undefined): {
    label: string;
    cssClass: string;
  } {
    if (!expirationDate)
      return { label: 'N/A', cssClass: 'text-muted bg-dark border-border' };
    const exp = new Date(expirationDate);
    const today = new Date();
    const diffTime = exp.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0)
      return {
        label: 'VENCIDO',
        cssClass: 'text-error bg-error/10 border-error/20',
      };
    if (diffDays <= 30)
      return {
        label: 'PRÓXIMO',
        cssClass: 'text-warning bg-warning/10 border-warning/20',
      };
    return {
      label: 'VIGENTE',
      cssClass: 'text-success bg-success/10 border-success/20',
    };
  }

  openDetail(eq: Equipment) {
    this.selectedEquipmentId.set(eq.id);
    this.showDetailModal.set(true);
  }

  openModal() {
    this.isEditMode = false;
    this.currentEditId = null;

    const globalContractId = this.authService.currentContractId();

    this.equipmentForm.reset({
      meterType: MeterType.HOURS,
      currentMeter: 0,
      contractId: globalContractId !== 'ALL' ? globalContractId : '',
      subcontractId: '',
    });

    this.equipmentForm
      .get('soapExp')
      ?.setValidators([Validators.required]);
    this.equipmentForm.get('soapExp')?.updateValueAndValidity();

    // Si hay un contrato global, bloqueamos el campo para que no pueda cambiarlo
    if (globalContractId !== 'ALL') {
      this.equipmentForm.get('contractId')?.disable();
      this.selectedContractId.set(globalContractId!);
    } else {
      this.equipmentForm.get('contractId')?.enable();
      this.selectedContractId.set('');
    }

    this.openEquipmentDialogNative();
  }

  editEquipment(eq: any) {
    this.isEditMode = true;
    this.currentEditId = eq.id;

    this.equipmentForm.get('soapExp')?.clearValidators();
    this.equipmentForm.get('soapExp')?.updateValueAndValidity();

    // Helper de fechas
    const formatDt = (isoStr: string | null | undefined) =>
      isoStr ? new Date(isoStr).toISOString().split('T')[0] : '';

    this.selectedContractId.set(eq.contractId || ''); // Trigger manual para cargar los subcontratos

    this.equipmentForm.patchValue({
      contractId: eq.contractId || '',
      subcontractId: eq.subcontractId || '',
      mineInternalId: eq.mineInternalId,
      internalId: eq.internalId,
      plate: eq.plate,
      type: eq.type,
      brand: eq.brand,
      model: eq.model,
      meterType: eq.meterType,
      currentMeter: eq.currentMeter,
      vin: eq.vin,
      engineNumber: eq.engineNumber,
      year: eq.year,
      fuelType: eq.fuelType,
      driveType: eq.driveType,
      ownership: eq.ownership,
      maintenanceFrequency: eq.maintenanceFrequency,

      lastMaintenanceDate: formatDt(eq.lastMaintenanceDate),
      lastMaintenanceMeter: eq.lastMaintenanceMeter,
      lastMaintenanceType: eq.lastMaintenanceType,

      techReviewExp: formatDt(eq.techReviewExp),
      circPermitExp: formatDt(eq.circPermitExp),
      soapExp: formatDt(eq.soapExp),
      mechanicalCertExp: formatDt(eq.mechanicalCertExp),
      liabilityPolicyExp: formatDt(eq.liabilityPolicyExp),
    });

    // En edición, dependiendo de la regla de negocio, usualmente permitimos cambiar el contrato
    // a menos que el usuario esté limitado por el selector global
    if (this.authService.currentContractId() !== 'ALL') {
      this.equipmentForm.get('contractId')?.disable();
    } else {
      this.equipmentForm.get('contractId')?.enable();
    }

    this.openEquipmentDialogNative();
  }

  private openEquipmentDialogNative(): void {
    this.showModal = true;
    afterNextRender(
      () => {
        const el = this.equipmentDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  deleteEquipment(id: string) {
    this.pendingDeleteId.set(id);
    this.showConfirmModal.set(true);
  }

  confirmDelete() {
    const id = this.pendingDeleteId();
    if (!id) return;

    this.fleetService.deleteEquipment(id).subscribe({
      next: () => {
        this.loadFleet();
        this.notificationService.success('Equipo eliminado exitosamente.');
        this.cancelDelete();
      },
      error: (err) => {
        console.error('Error al eliminar equipo', err);
        this.notificationService.error(
          err.error?.message || 'Error al eliminar el equipo',
        );
        this.cancelDelete();
      },
    });
  }

  cancelDelete() {
    this.showConfirmModal.set(false);
    this.pendingDeleteId.set(null);
  }

  closeModal() {
    const el = this.equipmentDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.resetEquipmentModalState();
    }
  }

  onEquipmentDialogClose() {
    this.resetEquipmentModalState();
  }

  private resetEquipmentModalState() {
    this.showModal = false;
    this.isEditMode = false;
    this.currentEditId = null;
  }

  onSubmit() {
    this.hasDuplicateError.set(false);
    if (this.equipmentForm.invalid) return;

    // Al estar deshabilitado contractId (cuando hay contexto global), getRawValue() obtiene todos los campos, incluso los disabled
    const formValue = this.equipmentForm.getRawValue();

    const subs = this.filteredSubcontracts();
    if (subs.length > 0 && !formValue.subcontractId) {
      this.notificationService.error(
        'Este contrato tiene subcontratos: debe seleccionar el subcontrato al que pertenece el equipo.',
      );
      return;
    }

    const payload: any = {
      ...formValue,
      subcontractId: formValue.subcontractId || null,
      year: formValue.year ? Number(formValue.year) : null,
      maintenanceFrequency: formValue.maintenanceFrequency
        ? Number(formValue.maintenanceFrequency)
        : null,
      currentMeter: formValue.currentMeter ? Number(formValue.currentMeter) : 0,
      lastMaintenanceMeter: formValue.lastMaintenanceMeter
        ? Number(formValue.lastMaintenanceMeter)
        : null,

      // Fechas a formato ISO
      lastMaintenanceDate: formValue.lastMaintenanceDate
        ? new Date(formValue.lastMaintenanceDate).toISOString()
        : null,
      techReviewExp: formValue.techReviewExp
        ? new Date(formValue.techReviewExp).toISOString()
        : null,
      circPermitExp: formValue.circPermitExp
        ? new Date(formValue.circPermitExp).toISOString()
        : null,
      soapExp: formValue.soapExp
        ? new Date(formValue.soapExp).toISOString()
        : null,
      mechanicalCertExp: formValue.mechanicalCertExp
        ? new Date(formValue.mechanicalCertExp).toISOString()
        : null,
      liabilityPolicyExp: formValue.liabilityPolicyExp
        ? new Date(formValue.liabilityPolicyExp).toISOString()
        : null,
    };

    if (!this.isEditMode) {
      payload.initialMeter = payload.currentMeter; // Set initial meter on creation
    }

    if (this.isEditMode && this.currentEditId) {
      this.fleetService.updateEquipment(this.currentEditId, payload).subscribe({
        next: () => {
          this.loadFleet();
          this.closeModal();
          this.notificationService.success('Equipo actualizado exitosamente.');
        },
        error: (err) => {
          if (err.status === 400) this.hasDuplicateError.set(true);
        },
      });
    } else {
      this.fleetService.createEquipment(payload).subscribe({
        next: () => {
          this.loadFleet();
          this.closeModal();
          this.notificationService.success('Equipo registrado exitosamente.');
        },
        error: (err) => {
          if (err.status === 400) this.hasDuplicateError.set(true);
        },
      });
    }
  }

  exportToExcel() {
    const data = this.fleet();
    if (data.length === 0) {
      this.notificationService.warning('No hay datos para exportar.');
      return;
    }

    const headersMap = {
      mineInternalId: 'N° int. mina',
      internalId: 'N° Interno',
      plate: 'Patente',
      type: 'Tipo',
      brand: 'Marca',
      model: 'Modelo',
      meterType: 'Medición',
      currentMeter: 'Medidor Actual',
      vin: 'VIN',
      engineNumber: 'N° Motor',
      year: 'Año',
      techReviewExp: 'Vence RT',
      circPermitExp: 'Vence P. Circ',
      soapExp: 'Vence SOAP',
      mechanicalCertExp: 'Vence Cert. Mec',
      liabilityPolicyExp: 'Vence Póliza RC',
    };

    this.exportService.exportToExcel(data, 'Maestro_Flota', headersMap);
  }

  downloadResume(eq: Equipment) {
    this.isDownloadingPdf.set(eq.id);
    this.notificationService.info('Generando Hoja de Vida...');

    this.workOrdersService
      .getWorkOrdersFiltered({
        equipmentId: eq.id,
        status: 'CLOSED',
        limit: 10,
      })
      .pipe(finalize(() => this.isDownloadingPdf.set(null)))
      .subscribe({
        next: (res) => {
          this.pdfService.generateEquipmentResume(eq, res.data);
          this.notificationService.success('PDF generado exitosamente.');
        },
        error: (err) => {
          console.error('Error fetching history for PDF', err);
          this.notificationService.error(
            'Error al obtener el historial de mantenimiento.',
          );
        },
      });
  }
}
