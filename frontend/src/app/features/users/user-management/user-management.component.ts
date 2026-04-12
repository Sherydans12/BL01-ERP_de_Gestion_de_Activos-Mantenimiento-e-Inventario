import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { UsersService, User } from '../../../core/services/users/users.service';
import {
  TenantRolesService,
  TenantRole,
} from '../../../core/services/tenant-roles/tenant-roles.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { finalize } from 'rxjs';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { Contract } from '../../../core/models/types'; // Uso del modelo tipado

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ConfirmModalComponent],
  template: `
    <div class="space-y-6 animate-fade-in pb-10">
      <header
        class="flex justify-between items-center bg-surface p-6 rounded-2xl shadow-lg border border-border backdrop-blur-xl"
      >
        <div>
          <h1
            class="text-3xl font-extrabold text-main tracking-tight flex items-center gap-3"
          >
            <svg
              class="w-8 h-8 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              ></path>
            </svg>
            Gestión de Usuarios
          </h1>
          <p class="text-muted mt-1 font-mono text-sm">
            Invita y administra a los miembros del equipo.
          </p>
        </div>
        <button
          (click)="openInviteModal()"
          class="bg-primary hover:bg-primary/90 text-white font-bold font-mono text-sm py-2.5 px-5 rounded-lg shadow-sm transition-all flex items-center gap-2"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
            ></path>
          </svg>
          INVITAR USUARIO
        </button>
      </header>

      <div
        class="bg-surface rounded-xl shadow-sm border border-border overflow-hidden backdrop-blur-xl"
      >
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead class="bg-dark/50">
              <tr
                class="text-xs uppercase tracking-wider text-muted font-mono border-b border-border"
              >
                <th class="px-6 py-4 font-medium">Nombre</th>
                <th class="px-6 py-4 font-medium">Email</th>
                <th class="px-6 py-4 font-medium">Rol</th>
                <th class="px-6 py-4 font-medium">RUT</th>
                <th class="px-6 py-4 font-medium">Cargo</th>
                <th class="px-6 py-4 font-medium text-center">Estado</th>
                <th class="px-6 py-4 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/50 text-sm">
              @for (user of paginatedUsers(); track user.id) {
                <tr class="hover:bg-dark/40 transition-colors duration-200">
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                      <div
                        class="h-8 w-8 rounded bg-dark border border-border flex items-center justify-center text-xs font-bold text-main uppercase"
                      >
                        {{ user.name.charAt(0) }}
                      </div>
                      <div class="font-medium text-main">
                        {{ user.name }}
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-muted">
                    {{ user.email }}
                  </td>
                  <td class="px-6 py-4">
                    <span
                      class="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded border"
                      [ngClass]="{
                        'bg-primary/10 text-primary border-primary/20':
                          user.role === 'ADMIN',
                        'bg-blue-900/20 text-blue-400 border-blue-500/20':
                          user.role === 'SUPERVISOR',
                        'bg-dark text-muted border-border':
                          user.role === 'MECHANIC',
                      }"
                    >
                      {{ user.customRole?.name || user.role }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-muted font-mono">
                    {{ user.rut || '-' }}
                  </td>
                  <td class="px-6 py-4 text-muted">
                    {{ user.position || '-' }}
                  </td>
                  <td class="px-6 py-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                      <span
                        class="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded border inline-flex items-center gap-1.5"
                        [ngClass]="
                          user.isActive
                            ? 'bg-success/10 text-success border-success/20'
                            : 'bg-warning/10 text-warning border-warning/20'
                        "
                      >
                        <span
                          class="w-1.5 h-1.5 rounded-full"
                          [ngClass]="
                            user.isActive ? 'bg-success' : 'bg-warning'
                          "
                        ></span>
                        {{ user.isActive ? 'Activo' : 'Inactivo' }}
                      </span>
                      <button
                        (click)="toggleUserStatus(user)"
                        [disabled]="isUpdatingStatus() === user.id"
                        class="p-1 rounded hover:bg-dark text-muted transition-all disabled:opacity-30"
                        title="Cambiar Estado"
                      >
                        @if (isUpdatingStatus() === user.id) {
                          <svg
                            class="animate-spin h-3.5 w-3.5"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              class="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              stroke-width="4"
                              fill="none"
                            ></circle>
                            <path
                              class="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            ></path>
                          </svg>
                        } @else {
                          <svg
                            class="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                            ></path>
                          </svg>
                        }
                      </button>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-right">
                    <div class="flex justify-end items-center gap-2">
                      @if (!user.isActive) {
                        <button
                          (click)="resendInvitation(user)"
                          class="text-primary hover:text-primary/80 font-mono text-xs transition-colors p-1"
                          title="Reenviar invitación"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                            />
                          </svg>
                        </button>
                      }
                      <button
                        (click)="openEditModal(user)"
                        class="text-muted hover:text-primary transition-colors font-mono text-xs p-1"
                      >
                        EDITAR
                      </button>
                      <button
                        (click)="confirmDelete(user)"
                        class="text-muted hover:text-error transition-colors font-mono text-xs p-1"
                      >
                        ELIMINAR
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td
                    colspan="7"
                    class="px-6 py-12 text-center text-muted font-mono"
                  >
                    No hay usuarios registrados
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (totalItems() > 0) {
          <div
            class="px-6 py-4 flex items-center justify-between border-t border-border bg-dark/20 text-sm"
          >
            <div class="text-muted font-mono">
              Mostrando
              <span class="font-bold text-main">{{
                (currentPage() - 1) * pageSize() + 1
              }}</span>
              a
              <span class="font-bold text-main">{{
                mathMin(currentPage() * pageSize(), totalItems())
              }}</span>
              de
              <span class="font-bold text-main">{{ totalItems() }}</span>
            </div>
            <div class="flex gap-2">
              <button
                (click)="changePage(currentPage() - 1)"
                [disabled]="currentPage() === 1"
                class="px-3 py-1.5 rounded bg-dark border border-border text-muted font-mono text-xs hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                ANTERIOR
              </button>
              <button
                (click)="changePage(currentPage() + 1)"
                [disabled]="currentPage() >= totalPages()"
                class="px-3 py-1.5 rounded bg-dark border border-border text-muted font-mono text-xs hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                SIGUIENTE
              </button>
            </div>
          </div>
        }
      </div>

      @if (formModalOpen()) {
        <dialog
          #userFormDialog
          class="dialog-native-shell [&::backdrop]:bg-black/70 [&::backdrop]:backdrop-blur-sm"
          (close)="onUserFormDialogClose()"
        >
          <div
            class="flex min-h-full w-full items-center justify-center overflow-y-auto p-4"
            (click)="closeFormModal()"
          >
          <div
            class="bg-surface rounded-xl shadow-2xl border border-border w-full max-w-lg overflow-hidden my-8 backdrop-blur-xl"
            (click)="$event.stopPropagation()"
          >
            <div class="p-6">
              <h3
                class="text-xl font-bold text-main mb-6 tracking-tight flex justify-between items-center"
              >
                <span>{{
                  isEditing() ? 'Editar Usuario' : 'Invitar Usuario'
                }}</span>
                <button
                  (click)="closeFormModal()"
                  class="text-muted hover:text-main"
                >
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    ></path>
                  </svg>
                </button>
              </h3>
              <form [formGroup]="userForm" class="space-y-4">
                <div>
                  <label
                    for="invite-name"
                    class="block text-sm font-medium text-main mb-1"
                    >Nombre completo</label
                  >
                  <input
                    id="invite-name"
                    type="text"
                    formControlName="name"
                    class="w-full bg-dark border border-border rounded-lg px-4 py-2 text-main focus:outline-none focus:border-primary placeholder:text-muted/50"
                    placeholder="Ej. Juan Pérez"
                  />
                </div>
                <div>
                  <label
                    for="invite-email"
                    class="block text-sm font-medium text-main mb-1"
                    >Correo electrónico</label
                  >
                  <input
                    id="invite-email"
                    type="email"
                    formControlName="email"
                    class="w-full bg-dark border border-border rounded-lg px-4 py-2 text-main focus:outline-none focus:border-primary placeholder:text-muted/50"
                    placeholder="correo@empresa.cl"
                  />
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      for="invite-rut"
                      class="block text-sm font-medium text-main mb-1"
                      >RUT</label
                    >
                    <input
                      id="invite-rut"
                      type="text"
                      formControlName="rut"
                      (input)="formatRut($event)"
                      class="w-full bg-dark border border-border rounded-lg px-4 py-2 text-main font-mono uppercase focus:outline-none focus:border-primary placeholder:text-muted/50"
                      placeholder="12.345.678-9"
                      maxlength="12"
                    />
                  </div>
                  <div>
                    <label
                      for="invite-phone"
                      class="block text-sm font-medium text-main mb-1"
                      >Teléfono</label
                    >
                    <input
                      id="invite-phone"
                      type="text"
                      formControlName="phone"
                      class="w-full bg-dark border border-border rounded-lg px-4 py-2 text-main font-mono focus:outline-none focus:border-primary placeholder:text-muted/50"
                      placeholder="+56 9 1234 5678"
                    />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      for="invite-birth"
                      class="block text-sm font-medium text-main mb-1"
                      >Fecha de nacimiento</label
                    >
                    <input
                      id="invite-birth"
                      type="date"
                      formControlName="birthDate"
                      class="w-full bg-dark border border-border rounded-lg px-4 py-2 text-main font-mono focus:outline-none focus:border-primary [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label
                      for="invite-position"
                      class="block text-sm font-medium text-main mb-1"
                      >Cargo</label
                    >
                    <input
                      id="invite-position"
                      type="text"
                      formControlName="position"
                      class="w-full bg-dark border border-border rounded-lg px-4 py-2 text-main focus:outline-none focus:border-primary placeholder:text-muted/50"
                      placeholder="Ej. Jefe de taller"
                    />
                  </div>
                </div>
                @if (isEditing()) {
                  <div>
                    <label
                      for="invite-active"
                      class="block text-sm font-medium text-main mb-1"
                      >Estado de la cuenta</label
                    >
                    <select
                      id="invite-active"
                      formControlName="isActive"
                      class="w-full bg-dark border border-border rounded-lg px-4 py-2 text-main focus:outline-none focus:border-primary"
                    >
                      <option [value]="true">Activo</option>
                      <option [value]="false">Inactivo</option>
                    </select>
                  </div>
                }
                <div>
                  <label
                    for="invite-tenant-role"
                    class="block text-sm font-medium text-main mb-1"
                    >Rol en la organización</label
                  >
                  <select
                    id="invite-tenant-role"
                    formControlName="tenantRoleId"
                    class="w-full bg-dark border border-border rounded-lg px-4 py-2 text-main focus:outline-none focus:border-primary"
                  >
                    @for (r of availableRoles(); track r.id) {
                      <option [value]="r.id">{{ r.name }}</option>
                    }
                  </select>
                  <p class="text-xs text-muted mt-1">
                    Incluye roles base (espejo) y roles personalizados del tenant.
                  </p>
                </div>

                @if (
                  selectedRoleBaseRole() === 'SUPERVISOR' ||
                  selectedRoleBaseRole() === 'MECHANIC'
                ) {
                  <div class="mt-6 pt-5 border-t border-border">
                    <label
                      class="block text-xs font-mono text-muted mb-3 uppercase tracking-wider"
                    >
                      Contratos Permitidos
                    </label>
                    <div
                      class="bg-dark/50 border border-border rounded-lg p-2 max-h-48 overflow-y-auto space-y-1"
                    >
                      @for (
                        contract of availableContracts();
                        track contract.id
                      ) {
                        <label
                          class="flex items-center gap-3 p-2 rounded hover:bg-surface cursor-pointer transition-all border border-transparent hover:border-border"
                        >
                          <input
                            type="checkbox"
                            class="appearance-none w-4 h-4 border border-border rounded bg-dark checked:bg-primary checked:border-primary transition-all cursor-pointer flex-shrink-0"
                            [checked]="isContractSelected(contract.id)"
                            (change)="toggleContractSelection(contract.id)"
                          />
                          <div class="flex flex-col">
                            <span class="text-sm text-main font-medium">{{
                              contract.name
                            }}</span>
                            <span class="text-[10px] text-primary font-mono">{{
                              contract.code
                            }}</span>
                          </div>
                        </label>
                      }
                      @if (availableContracts().length === 0) {
                        <div
                          class="py-4 text-center text-muted font-mono text-xs"
                        >
                          No hay contratos creados en el sistema.
                        </div>
                      }
                    </div>
                  </div>
                }
              </form>
            </div>
            <div
              class="bg-dark/50 border-t border-border p-4 flex justify-end gap-3"
            >
              <button
                (click)="closeFormModal()"
                class="px-4 py-2 text-sm font-medium text-muted hover:text-main transition-colors"
              >
                Cancelar
              </button>
              <button
                (click)="submitForm()"
                [disabled]="userForm.invalid || isSubmitting()"
                class="bg-primary hover:bg-primary/90 text-white font-bold font-mono text-sm py-2 px-6 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
              >
                {{
                  isSubmitting()
                    ? 'Procesando...'
                    : isEditing()
                      ? 'Guardar'
                      : 'Invitar'
                }}
              </button>
            </div>
          </div>
          </div>
        </dialog>
      }

      @if (deleteModalOpen()) {
        <dialog
          #userDeleteDialog
          class="dialog-native-shell [&::backdrop]:bg-black/70 [&::backdrop]:backdrop-blur-sm"
          (close)="onUserDeleteDialogClose()"
        >
          <div
            class="flex min-h-full w-full items-center justify-center overflow-y-auto p-4"
            (click)="closeDeleteModal()"
          >
          <div
            class="bg-surface rounded-xl border border-border w-full max-w-md overflow-hidden backdrop-blur-xl"
            (click)="$event.stopPropagation()"
          >
            <div class="p-6">
              <h3 class="text-lg font-bold text-error mb-2 tracking-tight">
                Eliminar Usuario
              </h3>
              <p class="text-sm text-muted">
                ¿Estás seguro de eliminar a
                <strong class="text-main">{{ userToDelete()?.name }}</strong
                >? Esta acción no se puede deshacer.
              </p>
            </div>
            <div
              class="bg-dark/50 border-t border-border p-4 flex justify-end gap-3"
            >
              <button
                (click)="closeDeleteModal()"
                class="px-4 py-2 text-sm font-medium text-muted hover:text-main"
              >
                Cancelar
              </button>
              <button
                (click)="deleteUser()"
                [disabled]="isDeleting()"
                class="bg-error hover:bg-error/90 text-white font-bold font-mono text-sm px-6 py-2 rounded disabled:opacity-50 transition-colors uppercase"
              >
                {{ isDeleting() ? 'Eliminando...' : 'Confirmar' }}
              </button>
            </div>
          </div>
          </div>
        </dialog>
      }

      <app-confirm-modal
        [isOpen]="confirmModalOpen()"
        [title]="confirmModalConfig().title"
        [message]="confirmModalConfig().message"
        [isDanger]="confirmModalConfig().isDanger"
        [confirmText]="confirmModalConfig().isDanger ? 'DESACTIVAR' : 'ACTIVAR'"
        (confirm)="onConfirmStatusChange()"
        (cancel)="closeConfirmModal()"
      ></app-confirm-modal>
    </div>
  `,
  styles: [
    `
      /* Simplificado el CSS del checkbox para adaptarlo al Glassmorphism */
      input[type='checkbox']:checked {
        background-image: url("data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e");
      }
    `,
  ],
})
export class UserManagementComponent implements OnInit {
  // Signals para el Modal de Confirmación
  confirmModalOpen = signal(false);
  confirmModalConfig = signal<{
    title: string;
    message: string;
    isDanger: boolean;
    user: User | null;
  }>({
    title: '',
    message: '',
    isDanger: false,
    user: null,
  });

  private injector = inject(Injector);
  private usersService = inject(UsersService);
  private contractsService = inject(ContractsService);
  private tenantRolesService = inject(TenantRolesService);
  private fb = inject(FormBuilder);
  private notification = inject(NotificationService);

  userFormDialog = viewChild<ElementRef<HTMLDialogElement>>('userFormDialog');
  userDeleteDialog =
    viewChild<ElementRef<HTMLDialogElement>>('userDeleteDialog');

  users = signal<User[]>([]);
  availableContracts = signal<Contract[]>([]);
  /** Roles del tenant (espejo + personalizados) para invitación/edición */
  availableRoles = signal<TenantRole[]>([]);
  /** Rol base (enum) del TenantRole seleccionado en el formulario */
  selectedRoleBaseRole = signal<TenantRole['baseRole'] | null>(null);

  // Paginación
  currentPage = signal(1);
  pageSize = signal(10);

  paginatedUsers = computed(() => this.users());
  totalItems = signal(0);
  totalPages = computed(() => Math.ceil(this.totalItems() / this.pageSize()));
  mathMin = Math.min;

  // Estados de modales
  formModalOpen = signal(false);
  deleteModalOpen = signal(false);

  isSubmitting = signal(false);
  isDeleting = signal(false);
  isEditing = signal(false);
  isUpdatingStatus = signal<string | null>(null);

  selectedUser = signal<User | null>(null);
  userToDelete = signal<User | null>(null);

  userForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    tenantRoleId: ['', Validators.required],
    rut: [''],
    phone: [''],
    birthDate: [''],
    position: [''],
    isActive: [true],
    contractIds: [[] as string[]], // Cambiado de siteIds
  });

  ngOnInit() {
    this.loadUsers();
    this.loadContracts();
    this.loadTenantRoles();

    this.userForm.get('tenantRoleId')?.valueChanges.subscribe((id) => {
      const r = this.availableRoles().find((x) => x.id === id);
      this.selectedRoleBaseRole.set(r?.baseRole ?? null);
    });
  }

  loadTenantRoles() {
    this.tenantRolesService.getAll().subscribe({
      next: (roles) => {
        this.availableRoles.set(roles);
        const id = this.userForm.get('tenantRoleId')?.value;
        if (typeof id === 'string' && id) {
          const r = roles.find((x) => x.id === id);
          this.selectedRoleBaseRole.set(r?.baseRole ?? null);
        }
      },
      error: () =>
        this.notification.error('No se pudieron cargar los roles del tenant'),
    });
  }

  loadContracts() {
    this.contractsService.findAll().subscribe({
      next: (contracts) => this.availableContracts.set(contracts),
      error: (err) => console.error(err),
    });
  }

  /**
   * Prepara el popup elegante de confirmación
   */
  toggleUserStatus(user: User) {
    const isDeactivating = user.isActive;

    this.confirmModalConfig.set({
      title: isDeactivating ? 'Desactivar Cuenta' : 'Activar Cuenta',
      isDanger: isDeactivating,
      user: user,
      message: isDeactivating
        ? `¿Está seguro de desactivar a ${user.name}? El usuario será expulsado del sistema inmediatamente si tiene una sesión activa.`
        : `¿Desea reactivar el acceso para ${user.name}?`,
    });

    this.confirmModalOpen.set(true);
  }

  /**
   * Ejecuta la acción tras la confirmación en el popup
   */
  onConfirmStatusChange() {
    const config = this.confirmModalConfig();
    if (!config.user) return;

    const user = config.user;
    this.isUpdatingStatus.set(user.id);
    this.confirmModalOpen.set(false);

    this.usersService
      .updateUser(user.id, { isActive: !user.isActive })
      .pipe(finalize(() => this.isUpdatingStatus.set(null)))
      .subscribe({
        next: (updatedUser) => {
          this.users.update((list) =>
            list.map((u) =>
              u.id === user.id ? { ...u, isActive: updatedUser.isActive } : u,
            ),
          );
          this.notification.success(`Estado de ${user.name} actualizado.`);
        },
        error: () =>
          this.notification.error('Error crítico al actualizar estado.'),
      });
  }

  closeConfirmModal() {
    this.confirmModalOpen.set(false);
    this.confirmModalConfig.update((c) => ({ ...c, user: null }));
  }

  loadUsers() {
    this.usersService.getUsers(this.currentPage(), this.pageSize()).subscribe({
      next: (res) => {
        this.users.set(res.items);
        this.totalItems.set(res.meta.total);

        const total = res.meta.lastPage;
        if (this.currentPage() > total && total > 0) {
          this.currentPage.set(total);
        }
      },
      error: () => this.notification.error('Error al cargar usuarios'),
    });
  }

  changePage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  openInviteModal() {
    this.isEditing.set(false);
    this.selectedUser.set(null);
    const roles = this.availableRoles();
    const defaultId = roles[0]?.id ?? '';
    this.userForm.reset({
      name: '',
      email: '',
      tenantRoleId: defaultId,
      rut: '',
      phone: '',
      birthDate: '',
      position: '',
      isActive: true,
      contractIds: [],
    });
    this.selectedRoleBaseRole.set(
      roles.find((x) => x.id === defaultId)?.baseRole ?? null,
    );
    this.formModalOpen.set(true);
    this.scheduleUserFormDialogOpen();
  }

  private scheduleUserFormDialogOpen(): void {
    afterNextRender(
      () => {
        const el = this.userFormDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  openEditModal(user: User) {
    this.isEditing.set(true);
    this.selectedUser.set(user);

    // Format date string for input max yyyy-MM-dd
    const formattedDate = user.birthDate
      ? new Date(user.birthDate).toISOString().split('T')[0]
      : '';

    const tenantRoleId = this.resolveTenantRoleIdForUser(user);

    this.userForm.patchValue({
      name: user.name,
      email: user.email,
      tenantRoleId,
      rut: user.rut || '',
      phone: user.phone || '',
      birthDate: formattedDate,
      position: user.position || '',
      isActive: user.isActive,
      // Mapea contractAccess a array de IDs
      contractIds: user.contractAccess
        ? user.contractAccess.map((ca: any) => ca.contractId)
        : [],
    });

    const r = this.availableRoles().find((x) => x.id === tenantRoleId);
    this.selectedRoleBaseRole.set(r?.baseRole ?? null);

    this.formModalOpen.set(true);
    this.scheduleUserFormDialogOpen();
  }

  /** Si el usuario no tiene customRoleId (legado), usa el rol espejo que coincida con User.role */
  private resolveTenantRoleIdForUser(user: User): string {
    const roles = this.availableRoles();
    if (user.customRoleId) {
      return user.customRoleId;
    }
    const mirror = roles.find(
      (tr) =>
        tr.baseRole === (user.role as TenantRole['baseRole']) &&
        tr.name.startsWith('Sistema'),
    );
    return mirror?.id ?? roles[0]?.id ?? '';
  }

  isContractSelected(id: string): boolean {
    const current = (this.userForm.get('contractIds')?.value as string[]) || [];
    return current.includes(id);
  }

  toggleContractSelection(id: string) {
    const current = (this.userForm.get('contractIds')?.value as string[]) || [];
    if (current.includes(id)) {
      this.userForm.patchValue({
        contractIds: current.filter((c) => c !== id),
      });
    } else {
      this.userForm.patchValue({ contractIds: [...current, id] });
    }
  }

  closeFormModal() {
    const el = this.userFormDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.formModalOpen.set(false);
    }
  }

  onUserFormDialogClose() {
    this.formModalOpen.set(false);
  }

  submitForm() {
    if (this.userForm.valid) {
      const payload = this.buildPayloadFromForm();
      if (!payload) {
        this.notification.error(
          'Seleccione un rol de organización válido en la lista.',
        );
        return;
      }

      if (payload.rut && !this.validateRut(payload.rut)) {
        this.notification.error(
          'El RUT ingresado no es válido (Dígito verificador incorrecto)',
        );
        return;
      }

      this.isSubmitting.set(true);

      if (this.isEditing() && this.selectedUser()) {
        const id = this.selectedUser()!.id;
        this.usersService
          .updateUser(id, payload)
          .pipe(finalize(() => this.isSubmitting.set(false)))
          .subscribe({
            next: () => {
              this.notification.success('Usuario actualizado exitosamente');
              this.closeFormModal();
              this.loadUsers();
            },
            error: (err) => {
              const msg = err.error?.message || 'Error al actualizar usuario';
              this.notification.error(msg);
            },
          });
      } else {
        const {
          isActive: _skip,
          ...inviteBody
        } = payload;
        void _skip;
        this.usersService
          .createUser(inviteBody)
          .pipe(finalize(() => this.isSubmitting.set(false)))
          .subscribe({
            next: () => {
              this.notification.success(
                'Invitación enviada exitosamente por correo',
              );
              this.closeFormModal();
              this.loadUsers();
            },
            error: (err) => {
              const msg = err.error?.message || 'Error al enviar invitación';
              this.notification.error(msg);
            },
          });
      }
    }
  }

  private buildPayloadFromForm():
    | {
        name: string;
        email: string;
        role: string;
        customRoleId: string;
        rut?: string;
        phone?: string;
        birthDate?: string;
        position?: string;
        isActive?: boolean;
        contractIds?: string[];
      }
    | null {
    const raw = this.userForm.getRawValue();
    const tr = this.availableRoles().find((r) => r.id === raw.tenantRoleId);
    if (!tr) return null;
    return {
      name: raw.name,
      email: raw.email,
      role: tr.baseRole,
      customRoleId: tr.id,
      rut: raw.rut?.trim() || undefined,
      phone: raw.phone?.trim() || undefined,
      birthDate: raw.birthDate?.trim() || undefined,
      position: raw.position?.trim() || undefined,
      isActive: raw.isActive,
      contractIds: raw.contractIds,
    };
  }

  validateRut(rut: string): boolean {
    if (!rut || rut.length < 8) return false;

    const cleanRut = rut.replace(/\./g, '').replace(/-/g, '');
    const body = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1).toUpperCase();

    let sum = 0;
    let multiplier = 2;

    for (let i = body.length - 1; i >= 0; i--) {
      sum += parseInt(body[i]) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }

    const expectedDv = 11 - (sum % 11);
    const dvFinal =
      expectedDv === 11 ? '0' : expectedDv === 10 ? 'K' : expectedDv.toString();

    return dv === dvFinal;
  }

  confirmDelete(user: User) {
    this.userToDelete.set(user);
    this.deleteModalOpen.set(true);
    afterNextRender(
      () => {
        const el = this.userDeleteDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  closeDeleteModal() {
    const el = this.userDeleteDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.deleteModalOpen.set(false);
      this.userToDelete.set(null);
    }
  }

  onUserDeleteDialogClose() {
    this.deleteModalOpen.set(false);
    this.userToDelete.set(null);
  }

  deleteUser() {
    const user = this.userToDelete();
    if (user) {
      this.isDeleting.set(true);
      this.usersService
        .deleteUser(user.id)
        .pipe(finalize(() => this.isDeleting.set(false)))
        .subscribe({
          next: () => {
            this.notification.success('Usuario eliminado exitosamente');
            this.closeDeleteModal();
            this.loadUsers();
          },
          error: (err) => this.notification.error('Error al eliminar usuario'),
        });
    }
  }

  formatRut(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/[^0-9kK]/g, '');

    if (value.length > 1) {
      const dv = value.slice(-1).toUpperCase();
      const cuerpo = value.slice(0, -1);

      let cuerpoFormateado = '';
      for (let i = cuerpo.length - 1, j = 1; i >= 0; i--, j++) {
        cuerpoFormateado = cuerpo.charAt(i) + cuerpoFormateado;
        if (j % 3 === 0 && j !== cuerpo.length)
          cuerpoFormateado = '.' + cuerpoFormateado;
      }

      value = `${cuerpoFormateado}-${dv}`;
    }

    this.userForm.get('rut')?.setValue(value, { emitEvent: false });
    input.value = value;
  }

  resendInvitation(user: User) {
    if (user.isActive) return;

    this.usersService.resendActivation(user.id).subscribe({
      next: () => {
        this.notification.success(`Invitación reenviada a ${user.email}`);
      },
      error: (err) => {
        const msg = err.error?.message || 'Error al reenviar invitación';
        this.notification.error(msg);
      },
    });
  }
}
