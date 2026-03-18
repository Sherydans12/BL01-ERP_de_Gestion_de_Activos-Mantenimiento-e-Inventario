import { Component, inject, OnInit, signal, computed } from '@angular/core'; // <-- Agregar OnInit y signal
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { CatalogService } from '../../../core/services/catalog/catalog.service';
import { FleetService } from '../../../core/services/fleet/fleet.service'; // <-- Importar
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { ExportService } from '../../../core/services/export/export.service';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs/operators';
import { PdfService } from '../../../core/services/pdf/pdf.service';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';

export interface Equipment {
  id: string;
  internalId: string;
  plate: string | null;
  type: string;
  brand: string;
  model: string;
  vin: string | null;
  engineNumber: string | null;
  year: number | null;
  fuelType: string | null;
  driveType: string | null;
  ownership: string | null;
  maintenanceFrequency: number | null;
  currentHorometer: number;
  techReviewExp: string | null;
  circPermitExp: string | null;
}

@Component({
  selector: 'app-fleet-master',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    ConfirmModalComponent,
  ],
  templateUrl: './fleet-master.component.html',
})
export class FleetMasterComponent implements OnInit {
  private fb = inject(FormBuilder);
  private catalogService = inject(CatalogService);
  private fleetService = inject(FleetService);
  private notificationService = inject(NotificationService);
  private exportService = inject(ExportService);
  private pdfService = inject(PdfService);
  private workOrdersService = inject(WorkOrdersService);

  equipmentTypes = this.catalogService.equipmentTypes;
  brands = this.catalogService.brands;
  fuelTypes = this.catalogService.fuelTypes;
  driveTypes = this.catalogService.driveTypes;
  ownerships = this.catalogService.ownerships;

  fleet = signal<Equipment[]>([]);

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

  // Subjects for debounce
  private searchSubject = new Subject<string>();

  showModal = false;
  isEditMode = false;
  currentEditId: string | null = null;

  equipmentForm: FormGroup = this.fb.group({
    // Identificación Base
    internalId: ['', [Validators.required]],
    plate: [''],
    type: ['', [Validators.required]],
    brand: ['', [Validators.required]],
    model: ['', [Validators.required]],

    // Identificación Extendida
    vin: [''],
    engineNumber: [''],
    year: [null],

    // Operación y Mantenimiento
    fuelType: [null],
    driveType: [null],
    ownership: [null],
    maintenanceFrequency: [null],
    currentHorometer: [0, [Validators.required, Validators.min(0)]],

    // Documentación
    techReviewExp: [''],
    circPermitExp: [''],
  });

  constructor() {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((query) => {
        this.searchQuery.set(query);
        this.currentPage.set(1); // Reset a primera página al buscar
        this.loadFleet();
      });
  }

  ngOnInit() {
    this.loadFleet();
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

  getDocStatus(expirationDate: string | null): {
    label: string;
    cssClass: string;
  } {
    if (!expirationDate)
      return { label: 'N/A', cssClass: 'text-gray-500 bg-dark border-border' };
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

  openModal() {
    this.isEditMode = false;
    this.currentEditId = null;
    this.equipmentForm.reset({
      initialHorometer: 0,
    });
    this.showModal = true;
  }

  editEquipment(eq: Equipment) {
    this.isEditMode = true;
    this.currentEditId = eq.id;

    // Format dates to YYYY-MM-DD for input[type="date"]
    const formatDt = (isoStr: string | null) =>
      isoStr ? new Date(isoStr).toISOString().split('T')[0] : '';

    this.equipmentForm.patchValue({
      internalId: eq.internalId,
      plate: eq.plate,
      type: eq.type,
      brand: eq.brand,
      model: eq.model,
      vin: eq.vin,
      engineNumber: eq.engineNumber,
      year: eq.year,
      fuelType: eq.fuelType,
      driveType: eq.driveType,
      ownership: eq.ownership,
      maintenanceFrequency: eq.maintenanceFrequency,
      currentHorometer: eq.currentHorometer,
      techReviewExp: formatDt(eq.techReviewExp),
      circPermitExp: formatDt(eq.circPermitExp),
    });

    this.showModal = true;
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
        // El interceptor ya mostrará el toast de error.
        console.error('Error al eliminar equipo', err);
        this.cancelDelete();
      },
    });
  }

  cancelDelete() {
    this.showConfirmModal.set(false);
    this.pendingDeleteId.set(null);
  }

  closeModal() {
    this.showModal = false;
    this.isEditMode = false;
    this.currentEditId = null;
  }

  onSubmit() {
    this.hasDuplicateError.set(false);

    if (this.equipmentForm.invalid) return;

    const formValue = this.equipmentForm.value;

    const payload: any = {
      ...formValue,
      year: formValue.year ? Number(formValue.year) : null,
      maintenanceFrequency: formValue.maintenanceFrequency
        ? Number(formValue.maintenanceFrequency)
        : null,
      currentHorometer: formValue.currentHorometer
        ? Number(formValue.currentHorometer)
        : 0,
      techReviewExp: formValue.techReviewExp
        ? new Date(formValue.techReviewExp).toISOString()
        : null,
      circPermitExp: formValue.circPermitExp
        ? new Date(formValue.circPermitExp).toISOString()
        : null,
    };

    if (!this.isEditMode) {
      payload.initialHorometer = payload.currentHorometer;
    }

    if (this.isEditMode && this.currentEditId) {
      // PUT request
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
      // POST request
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
  // --- EXPORTACIÓN ---
  exportToExcel() {
    const data = this.fleet();
    if (data.length === 0) {
      this.notificationService.warning('No hay datos para exportar.');
      return;
    }

    const headersMap = {
      internalId: 'N° Interno',
      plate: 'Patente',
      type: 'Tipo',
      brand: 'Marca',
      model: 'Modelo',
      vin: 'VIN',
      engineNumber: 'N° Motor',
      year: 'Año',
      fuelType: 'Combustible',
      driveType: 'Tracción',
      ownership: 'Propiedad',
      maintenanceFrequency: 'Frec. Mantenimiento',
      currentHorometer: 'Horómetro Actual',
      techReviewExp: 'Vence RT',
      circPermitExp: 'Vence P. Circulación',
    };

    this.exportService.exportToExcel(data, 'Maestro_Flota', headersMap);
  }

  downloadResume(eq: Equipment) {
    this.isDownloadingPdf.set(eq.id);
    this.notificationService.info('Generando Hoja de Vida...');

    // Fetch last 10 closed OTs for this equipment
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
