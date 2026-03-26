import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormArray,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http'; // Para cargar la lista de contratos/subcontratos
import { environment } from '../../../../environments/environment';

import { MaintenanceKitsService } from '../../../core/services/maintenance-kits/maintenance-kits.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-kit-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './kit-form.component.html',
})
export class KitFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private maintenanceKitsService = inject(MaintenanceKitsService);
  private fleetService = inject(FleetService);
  public authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private http = inject(HttpClient); // <--- Inyectado para traer subcontratos

  kitId: string | null = null;
  mode: 'CREATING' | 'EDITING' = 'CREATING';

  kitForm: FormGroup;

  fleet = signal<any[]>([]);
  contractsWithSubs = signal<any[]>([]); // Almacena Contratos + Subcontratos
  selectedBrand = signal<string>('');
  selectedContractId = signal<string>('');

  uniqueBrands = computed(() => {
    const contractId = this.selectedContractId();
    let currentFleet = this.fleet();

    // 1. Filtrar flota por el contrato seleccionado en el formulario
    if (contractId) {
      currentFleet = currentFleet.filter((e) => e.contractId === contractId);
    }

    const brands = currentFleet.map((e) => e.brand).filter(Boolean);
    return [...new Set(brands)].sort();
  });

  uniqueModels = computed(() => {
    const contractId = this.selectedContractId();
    const brand = this.selectedBrand();
    if (!brand) return [];

    let currentFleet = this.fleet();

    // 1. Filtrar flota por el contrato seleccionado en el formulario
    if (contractId) {
      currentFleet = currentFleet.filter((e) => e.contractId === contractId);
    }

    const models = currentFleet
      .filter((e) => e.brand === brand)
      .map((e) => e.model)
      .filter(Boolean);
    return [...new Set(models)].sort();
  });

  availableSubcontracts = computed(() => {
    const contractId = this.selectedContractId(); // <--- USA LA SIGNAL
    if (!contractId) return [];

    const contract = this.contractsWithSubs().find((c) => c.id === contractId);
    return contract?.subcontracts || [];
  });

  constructor() {
    this.kitForm = this.fb.group({
      code: ['', Validators.required],
      name: ['', Validators.required],
      description: [''],
      contractId: ['', Validators.required], // OBLIGATORIO
      subcontractId: [''], // OPCIONAL
      equipmentBrand: [''],
      equipmentModel: [''],
      parts: this.fb.array([]),
    });

    this.kitForm.get('equipmentBrand')?.valueChanges.subscribe((val) => {
      this.selectedBrand.set(val || '');
      this.kitForm.get('equipmentModel')?.setValue('');
    });

    this.kitForm.get('contractId')?.valueChanges.subscribe((val) => {
      this.selectedContractId.set(val || '');
      // Si cambian el contrato, se resetean subcontrato y equipo
      this.kitForm.get('subcontractId')?.setValue('');
      this.kitForm.get('equipmentBrand')?.setValue('');
    });

    effect(
      () => {
        const currentContract = this.authService.currentContractId();
        this.fleetService
          .getEquipments({
            limit: 1000,
            contractId: currentContract !== 'ALL' ? currentContract : undefined,
          })
          .subscribe((res) => {
            this.fleet.set(res.data);
          });

        // LÓGICA DE BLOQUEO DE CONTRATO
        if (currentContract !== 'ALL') {
          this.kitForm.patchValue({ contractId: currentContract });
          this.kitForm.get('contractId')?.disable(); // Lo bloquea para que el usuario no lo cambie
        } else {
          this.kitForm.get('contractId')?.enable();
        }
      },
      { allowSignalWrites: true },
    );
  }

  get partsArray(): FormArray {
    return this.kitForm.get('parts') as FormArray;
  }

  ngOnInit() {
    // Cargar la lista completa de Contratos y sus Subcontratos desde el backend
    this.http.get<any[]>(`${environment.apiUrl}/contracts`).subscribe({
      next: (data) => this.contractsWithSubs.set(data),
      error: (err) => console.error('Error cargando contratos', err),
    });

    this.route.paramMap.subscribe((params) => {
      this.kitId = params.get('id');
      if (this.kitId) {
        this.mode = 'EDITING';
        this.loadKit(this.kitId);
      } else {
        this.addPartRow();
      }
    });
  }

  loadKit(id: string) {
    this.maintenanceKitsService.getKit(id).subscribe({
      next: (kit) => {
        this.kitForm.patchValue(
          {
            code: kit.code,
            name: kit.name,
            description: kit.description,
            contractId: kit.contractId,
            subcontractId: kit.subcontractId || '',
            equipmentBrand: kit.equipmentBrand || '',
          },
          { emitEvent: false },
        );

        // --- CORRECCIÓN: Sincronizar Signals ---
        this.selectedContractId.set(kit.contractId || '');
        this.selectedBrand.set(kit.equipmentBrand || '');

        this.kitForm.patchValue({
          equipmentModel: kit.equipmentModel || '',
        });

        if (kit.parts && kit.parts.length > 0) {
          kit.parts.forEach((p: any) => {
            this.partsArray.push(
              this.fb.group({
                quantity: [
                  p.quantity,
                  [Validators.required, Validators.min(1)],
                ],
                partNumber: [p.partNumber, Validators.required],
                description: [p.description, Validators.required],
              }),
            );
          });
        }
      },
      error: () => {
        this.notificationService.error('Kit no encontrado');
        this.router.navigate(['/app/kits']);
      },
    });
  }

  addPartRow() {
    this.partsArray.push(
      this.fb.group({
        quantity: [1, [Validators.required, Validators.min(1)]],
        partNumber: ['', Validators.required],
        description: ['', Validators.required],
      }),
    );
  }

  removePartRow(index: number) {
    this.partsArray.removeAt(index);
  }

  onSubmit() {
    if (this.kitForm.invalid) {
      this.kitForm.markAllAsTouched();
      return;
    }

    // getRawValue() extrae incluso los campos disabled (como contractId cuando está bloqueado)
    const formValues = this.kitForm.getRawValue();

    const payload = {
      ...formValues,
      subcontractId: formValues.subcontractId || null,
    };

    if (this.mode === 'CREATING') {
      this.maintenanceKitsService.createKit(payload).subscribe({
        next: () => {
          this.notificationService.success('Kit creado exitosamente.');
          this.router.navigate(['/app/kits']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'Error al crear.',
          ),
      });
    } else if (this.kitId) {
      this.maintenanceKitsService.updateKit(this.kitId, payload).subscribe({
        next: () => {
          this.notificationService.success('Kit actualizado exitosamente.');
          this.router.navigate(['/app/kits']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'Error al actualizar.',
          ),
      });
    }
  }
}
