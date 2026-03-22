import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { UsersService, User } from '../../../core/services/users/users.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { finalize } from 'rxjs';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { SitesService } from '../../../core/services/sites/sites.service';

export interface Site {
  id: string;
  name: string;
  code: string;
}

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ConfirmModalComponent],
  template: `
    <div class="space-y-6 animate-fade-in pb-10">
      <header
        class="flex justify-between items-center bg-surface p-6 rounded-2xl shadow-lg border border-border"
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
          <p class="text-muted mt-1">
            Invita y administra a los miembros del equipo.
          </p>
        </div>
        <button
          (click)="openInviteModal()"
          class="btn-primary flex items-center gap-2"
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
        class="bg-surface rounded-xl shadow-lg border border-border overflow-hidden"
      >
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-700">
            <thead class="bg-dark/50">
              <tr>
                <th
                  class="px-6 py-4 text-left text-xs font-medium text-muted uppercase"
                >
                  Nombre
                </th>
                <th
                  class="px-6 py-4 text-left text-xs font-medium text-muted uppercase"
                >
                  Email
                </th>
                <th
                  class="px-6 py-4 text-left text-xs font-medium text-muted uppercase"
                >
                  Rol
                </th>
                <th
                  class="px-6 py-4 text-left text-xs font-medium text-muted uppercase"
                >
                  RUT
                </th>
                <th
                  class="px-6 py-4 text-left text-xs font-medium text-muted uppercase"
                >
                  Cargo
                </th>
                <th
                  class="px-6 py-4 text-left text-xs font-medium text-muted uppercase"
                >
                  Estado
                </th>
                <th
                  class="px-6 py-4 text-right text-xs font-medium text-muted uppercase"
                >
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-700 bg-surface">
              @for (user of paginatedUsers(); track user.id) {
                <tr class="hover:bg-gray-750 transition-colors duration-200">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex items-center gap-3">
                      <div
                        class="h-8 w-8 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center text-sm font-bold text-main uppercase"
                      >
                        {{ user.name.charAt(0) }}
                      </div>
                      <div class="text-sm font-medium text-main">
                        {{ user.name }}
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-sm text-muted">
                    {{ user.email }}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <span
                      class="px-3 py-1 text-xs font-semibold rounded-full border"
                      [ngClass]="{
                        'bg-primary/20 text-primary border-primary/30':
                          user.role === 'ADMIN',
                        'bg-blue-900/40 text-blue-400 border-blue-500/30':
                          user.role === 'SUPERVISOR',
                        'bg-gray-700 text-muted border-gray-600':
                          user.role === 'MECHANIC',
                      }"
                    >
                      {{ user.role }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-sm text-muted font-mono">
                    {{ user.rut || '-' }}
                  </td>
                  <td class="px-6 py-4 text-sm text-muted">
                    {{ user.position || '-' }}
                  </td>
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-2">
                      <span
                        class="px-3 py-1 text-xs font-semibold rounded-full border"
                        [ngClass]="
                          user.isActive
                            ? 'bg-success/20 text-success border-success/30'
                            : 'bg-warning/20 text-warning border-warning/30'
                        "
                      >
                        {{ user.isActive ? 'Activo' : 'Inactivo' }}
                      </span>
                      <button
                        (click)="toggleUserStatus(user)"
                        [disabled]="isUpdatingStatus() === user.id"
                        class="p-1 rounded-lg hover:bg-dark text-muted transition-all disabled:opacity-30"
                      >
                        @if (isUpdatingStatus() === user.id) {
                          <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
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
                            class="w-4 h-4"
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
                  <td
                    class="px-6 py-4 text-right text-sm font-medium flex justify-end items-center gap-2"
                  >
                    @if (!user.isActive) {
                      <button
                        (click)="resendInvitation(user)"
                        class="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        title="Reenviar invitación"
                      >
                        <svg
                          class="w-5 h-5"
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
                      class="text-blue-400 hover:text-blue-300 p-2"
                    >
                      Editar
                    </button>
                    <button
                      (click)="confirmDelete(user)"
                      class="text-red-400 hover:text-red-300 p-2"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="px-6 py-12 text-center text-muted">
                    No hay usuarios registrados
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (totalItems() > 0) {
          <div
            class="px-6 py-4 border-t border-border bg-dark/50 flex items-center justify-between"
          >
            <div class="text-sm text-muted">
              Mostrando
              <span class="text-main">{{
                (currentPage() - 1) * pageSize() + 1
              }}</span>
              a
              <span class="text-main">{{
                mathMin(currentPage() * pageSize(), totalItems())
              }}</span>
              de
              <span class="text-main">{{ totalItems() }}</span>
            </div>
            <div class="flex gap-2">
              <button
                (click)="changePage(currentPage() - 1)"
                [disabled]="currentPage() === 1"
                class="px-4 py-2 border border-gray-600 rounded-lg text-sm font-medium text-muted hover:bg-dark disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                (click)="changePage(currentPage() + 1)"
                [disabled]="currentPage() >= totalPages()"
                class="px-4 py-2 border border-gray-600 rounded-lg text-sm font-medium text-muted hover:bg-dark disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        }
      </div>

      @if (formModalOpen()) {
        <div
          class="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4"
        >
          <div
            class="fixed inset-0 bg-black/75"
            (click)="closeFormModal()"
          ></div>
          <div
            class="bg-surface rounded-xl shadow-2xl border border-border w-full max-w-lg z-10 overflow-hidden"
          >
            <div class="p-6">
              <h3 class="text-lg font-bold text-main mb-4">
                {{ isEditing() ? 'Editar Usuario' : 'Invitar Usuario' }}
              </h3>
              <form [formGroup]="userForm" class="space-y-4">
                <input
                  type="text"
                  formControlName="name"
                  class="input-field w-full"
                  placeholder="Nombre Completo"
                />
                <input
                  type="email"
                  formControlName="email"
                  class="input-field w-full"
                  placeholder="Email"
                />
                <div class="grid grid-cols-2 gap-4">
                  <input
                    type="text"
                    formControlName="rut"
                    (input)="formatRut($event)"
                    class="input-field w-full"
                    placeholder="RUT"
                    maxlength="12"
                  />
                  <input
                    type="text"
                    formControlName="phone"
                    class="input-field w-full"
                    placeholder="Teléfono"
                  />
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <input
                    type="date"
                    formControlName="birthDate"
                    class="input-field w-full"
                  />
                  <input
                    type="text"
                    formControlName="position"
                    class="input-field w-full"
                    placeholder="Cargo"
                  />
                </div>
                @if (isEditing()) {
                  <select formControlName="isActive" class="input-field w-full">
                    <option [value]="true">Activo</option>
                    <option [value]="false">Inactivo</option>
                  </select>
                }
                <select formControlName="role" class="input-field w-full">
                  <option value="MECHANIC">Mecánico</option>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="ADMIN">Administrador</option>
                </select>

                <!-- Selector de Faenas -->
                @if (
                  userForm.get('role')?.value === 'SUPERVISOR' ||
                  userForm.get('role')?.value === 'MECHANIC'
                ) {
                  <div class="mt-5 pt-5 border-t border-border">
                    <label
                      class="block text-xs font-mono text-muted mb-3 uppercase tracking-wider"
                    >
                      Faenas Permitidas
                    </label>
                    <div
                      class="bg-black/40 border border-white/5 rounded-xl p-4 max-h-52 overflow-y-auto space-y-2 relative shadow-inner"
                    >
                      @for (site of availableSites(); track site.id) {
                        <label
                          class="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition-all border border-transparent hover:border-border"
                        >
                          <div
                            class="relative flex items-center justify-center"
                          >
                            <input
                              type="checkbox"
                              class="peer appearance-none w-5 h-5 border-2 border-border rounded shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)] bg-black/50 checked:bg-primary checked:border-primary transition-all duration-300 cursor-pointer"
                              [checked]="isSiteSelected(site.id)"
                              (change)="toggleSiteSelection(site.id)"
                            />
                            <svg
                              class="absolute w-3.5 h-3.5 text-dark opacity-0 peer-checked:opacity-100 transition-opacity duration-300 pointer-events-none scale-50 peer-checked:scale-100"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="3"
                                d="M5 13l4 4L19 7"
                              ></path>
                            </svg>
                          </div>
                          <div class="flex flex-col">
                            <span
                              class="text-sm text-main font-medium tracking-wide"
                              >{{ site.name }}</span
                            >
                            <span
                              class="text-xs text-primary font-mono bg-primary/10 px-1.5 py-0.5 mt-1 rounded inline-block w-fit border border-primary/20"
                              >{{ site.code }}</span
                            >
                          </div>
                        </label>
                      }
                      @if (availableSites().length === 0) {
                        <div
                          class="flex flex-col items-center justify-center py-6 text-muted gap-2"
                        >
                          <svg
                            class="w-8 h-8 opacity-50 mb-2"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="1.5"
                              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                            ></path>
                          </svg>
                          <span
                            class="text-xs font-mono tracking-wider uppercase text-center"
                            >No hay faenas creadas<br />en el sistema.</span
                          >
                        </div>
                      }
                    </div>
                  </div>
                }
              </form>
            </div>
            <div class="bg-surface p-4 flex justify-end gap-3">
              <button
                (click)="closeFormModal()"
                class="px-4 py-2 text-muted hover:text-main"
              >
                Cancelar
              </button>
              <button
                (click)="submitForm()"
                [disabled]="userForm.invalid || isSubmitting()"
                class="btn-primary px-6 py-2"
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
      }

      @if (deleteModalOpen()) {
        <div
          class="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4"
        >
          <div
            class="fixed inset-0 bg-black/75"
            (click)="closeDeleteModal()"
          ></div>
          <div
            class="bg-surface rounded-xl border border-border w-full max-w-md z-10 overflow-hidden"
          >
            <div class="p-6">
              <h3 class="text-lg font-bold text-main mb-2 text-red-500">
                Eliminar Usuario
              </h3>
              <p class="text-muted">
                ¿Estás seguro de eliminar a
                <strong>{{ userToDelete()?.name }}</strong
                >?
              </p>
            </div>
            <div class="bg-surface p-4 flex justify-end gap-3">
              <button
                (click)="closeDeleteModal()"
                class="px-4 py-2 text-muted"
              >
                Cancelar
              </button>
              <button
                (click)="deleteUser()"
                [disabled]="isDeleting()"
                class="bg-red-600 hover:bg-red-700 text-main px-6 py-2 rounded-lg"
              >
                {{ isDeleting() ? 'Eliminando...' : 'Confirmar' }}
              </button>
            </div>
          </div>
        </div>
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
  styles: [],
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

  private usersService = inject(UsersService);
  private sitesService = inject(SitesService);
  private fb = inject(FormBuilder);
  private notification = inject(NotificationService);

  users = signal<User[]>([]);
  availableSites = signal<Site[]>([]);

  // Paginación
  currentPage = signal(1);
  pageSize = signal(10);

  paginatedUsers = computed(() => this.users());

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
    role: ['MECHANIC', Validators.required],
    rut: [''],
    phone: [''],
    birthDate: [''],
    position: [''],
    isActive: [true],
    siteIds: [[] as string[]],
  });

  ngOnInit() {
    this.loadUsers();
    this.loadSites();
  }

  loadSites() {
    this.sitesService.findAll().subscribe({
      next: (sites) => this.availableSites.set(sites),
      error: () => console.error('Error cargando faenas'),
    });
  }

  totalItems = signal(0);

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
    this.confirmModalOpen.set(false); // Cerramos el modal antes de la petición para UX fluida

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
        // res es de tipo PaginatedUsers
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
    this.userForm.reset({ role: 'MECHANIC', isActive: true, siteIds: [] });
    this.formModalOpen.set(true);
  }

  openEditModal(user: User) {
    this.isEditing.set(true);
    this.selectedUser.set(user);

    // Format date string for input max yyyy-MM-dd
    const formattedDate = user.birthDate
      ? new Date(user.birthDate).toISOString().split('T')[0]
      : '';

    this.userForm.patchValue({
      name: user.name,
      email: user.email,
      role: user.role,
      rut: user.rut || '',
      phone: user.phone || '',
      birthDate: formattedDate,
      position: user.position || '',
      isActive: user.isActive,
      siteIds: user.siteAccess ? user.siteAccess.map((sa) => sa.siteId) : [],
    });

    this.formModalOpen.set(true);
  }

  isSiteSelected(id: string): boolean {
    const current = (this.userForm.get('siteIds')?.value as string[]) || [];
    return current.includes(id);
  }

  toggleSiteSelection(id: string) {
    const current = (this.userForm.get('siteIds')?.value as string[]) || [];
    if (current.includes(id)) {
      this.userForm.patchValue({ siteIds: current.filter((s) => s !== id) });
    } else {
      this.userForm.patchValue({ siteIds: [...current, id] });
    }
  }

  closeFormModal() {
    this.formModalOpen.set(false);
  }

  submitForm() {
    if (this.userForm.valid) {
      const formData = this.userForm.getRawValue();

      // 1. Validación de RUT (Módulo 11) antes de enviar
      if (formData.rut && !this.validateRut(formData.rut)) {
        this.notification.error(
          'El RUT ingresado no es válido (Dígito verificador incorrecto)',
        );
        return; // Detenemos la ejecución
      }

      this.isSubmitting.set(true);

      if (this.isEditing() && this.selectedUser()) {
        const id = this.selectedUser()!.id;
        this.usersService
          .updateUser(id, formData)
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
        this.usersService
          .createUser(formData)
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

  // Validador de RUT Chileno
  validateRut(rut: string): boolean {
    if (!rut || rut.length < 8) return false;

    // Limpiar puntos y guion
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
  }

  closeDeleteModal() {
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
    let value = input.value.replace(/[^0-9kK]/g, ''); // Limpiar caracteres no válidos

    if (value.length > 1) {
      const dv = value.slice(-1).toUpperCase();
      const cuerpo = value.slice(0, -1);

      // Formatear con puntos (opcional, pero recomendado para el diseño industrial)
      let cuerpoFormateado = '';
      for (let i = cuerpo.length - 1, j = 1; i >= 0; i--, j++) {
        cuerpoFormateado = cuerpo.charAt(i) + cuerpoFormateado;
        if (j % 3 === 0 && j !== cuerpo.length)
          cuerpoFormateado = '.' + cuerpoFormateado;
      }

      value = `${cuerpoFormateado}-${dv}`;
    }

    // Actualizar el valor en el control y en el input visual
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
