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
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-warehouse-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './warehouse-form.component.html',
})
export class WarehouseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private warehousesService = inject(WarehousesService);
  public authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private http = inject(HttpClient);

  warehouseId: string | null = null;
  mode: 'CREATING' | 'EDITING' = 'CREATING';
  warehouseForm: FormGroup;

  contractsWithSubs = signal<any[]>([]);
  selectedContractId = signal<string>('');

  availableSubcontracts = computed(() => {
    const contractId = this.selectedContractId();
    if (!contractId) return [];
    const contract = this.contractsWithSubs().find((c) => c.id === contractId);
    return contract?.subcontracts || [];
  });

  constructor() {
    this.warehouseForm = this.fb.group({
      code: ['', Validators.required],
      name: ['', Validators.required],
      location: [''],
      contractId: ['', Validators.required],
      subcontractId: [''],
      isActive: [true],
    });

    this.warehouseForm.get('contractId')?.valueChanges.subscribe((val) => {
      this.selectedContractId.set(val || '');
      this.warehouseForm.get('subcontractId')?.setValue('');
    });

    effect(
      () => {
        const currentContract = this.authService.currentContractId();
        if (currentContract !== 'ALL') {
          this.warehouseForm.patchValue({ contractId: currentContract });
          this.warehouseForm.get('contractId')?.disable();
        } else {
          this.warehouseForm.get('contractId')?.enable();
        }
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit() {
    this.http.get<any[]>(`${environment.apiUrl}/contracts`).subscribe({
      next: (data) => this.contractsWithSubs.set(data),
      error: (err) => console.error('Error cargando contratos', err),
    });

    this.route.paramMap.subscribe((params) => {
      this.warehouseId = params.get('id');
      if (this.warehouseId) {
        this.mode = 'EDITING';
        this.loadWarehouse(this.warehouseId);
      }
    });
  }

  loadWarehouse(id: string) {
    this.warehousesService.getWarehouse(id).subscribe({
      next: (wh) => {
        this.warehouseForm.patchValue(
          {
            code: wh.code,
            name: wh.name,
            location: wh.location,
            contractId: wh.contractId,
            subcontractId: wh.subcontractId || '',
            isActive: wh.isActive,
          },
          { emitEvent: false },
        );
        this.selectedContractId.set(wh.contractId || '');
      },
      error: () => {
        this.notificationService.error('Bodega no encontrada');
        this.router.navigate(['/app/bodegas']);
      },
    });
  }

  onSubmit() {
    if (this.warehouseForm.invalid) {
      this.warehouseForm.markAllAsTouched();
      return;
    }

    const formValues = this.warehouseForm.getRawValue(); // Captura campos disabled
    const payload = {
      ...formValues,
      subcontractId: formValues.subcontractId || null,
    };

    if (this.mode === 'CREATING') {
      this.warehousesService.createWarehouse(payload).subscribe({
        next: () => {
          this.notificationService.success('Bodega creada.');
          this.router.navigate(['/app/bodegas']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'Error al crear.',
          ),
      });
    } else if (this.warehouseId) {
      this.warehousesService
        .updateWarehouse(this.warehouseId, payload)
        .subscribe({
          next: () => {
            this.notificationService.success('Bodega actualizada.');
            this.router.navigate(['/app/bodegas']);
          },
          error: (err) =>
            this.notificationService.error(
              err.error?.message || 'Error al actualizar.',
            ),
        });
    }
  }
}
