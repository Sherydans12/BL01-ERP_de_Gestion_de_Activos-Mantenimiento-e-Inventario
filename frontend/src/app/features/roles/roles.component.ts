import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import {
  NAV_SECTIONS,
  AppRole,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
} from '../../core/navigation/nav.config';
import { UsersService } from '../../core/services/users/users.service';
import { TenantService } from '../../core/services/tenant/tenant.service';
import { TenantRolesService, TenantRole } from '../../core/services/tenant-roles/tenant-roles.service';
import { NotificationService } from '../../core/services/notification/notification.service';

type BaseRole = 'MECHANIC' | 'SUPERVISOR' | 'ADMIN';
type ModalMode = 'custom-create' | 'custom-edit' | 'system-edit';

const SYSTEM_ROLES: BaseRole[] = ['MECHANIC', 'SUPERVISOR', 'ADMIN'];

const BADGE_CLASSES: Record<AppRole, string> = {
  SUPER_ADMIN: 'bg-purple-500/15 text-purple-300 border border-purple-500/30',
  ADMIN: 'bg-primary/15 text-primary border border-primary/30',
  SUPERVISOR: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  MECHANIC: 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/30',
};

const ROLE_ACCENT: Record<BaseRole, string> = {
  ADMIN: 'border-primary/30 hover:border-primary/50',
  SUPERVISOR: 'border-blue-500/20 hover:border-blue-500/40',
  MECHANIC: 'border-zinc-500/20 hover:border-zinc-500/40',
};

const BASE_ROLE_BADGE: Record<BaseRole, string> = {
  ADMIN: 'bg-primary/15 text-primary border-primary/30',
  SUPERVISOR: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  MECHANIC: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

interface ApiPermGroup {
  label: string;
  items: Array<{ text: string; allowed: boolean }>;
}

const BASE_ROLE_API: Record<BaseRole, { summary: string; groups: ApiPermGroup[] }> = {
  MECHANIC: {
    summary: 'Operario de campo. Acceso de lectura/ejecución sobre las entidades del día a día.',
    groups: [
      {
        label: 'Órdenes de Trabajo',
        items: [
          { text: 'Ver y filtrar órdenes asignadas', allowed: true },
          { text: 'Actualizar estado / agregar notas', allowed: true },
          { text: 'Crear o reasignar órdenes', allowed: false },
          { text: 'Eliminar órdenes', allowed: false },
        ],
      },
      {
        label: 'Flota e Inventario',
        items: [
          { text: 'Consultar equipos y flota', allowed: true },
          { text: 'Registrar lecturas de medidor', allowed: true },
          { text: 'Consultar stock disponible', allowed: true },
          { text: 'Crear / modificar artículos del catálogo', allowed: false },
          { text: 'Gestionar bodegas o movimientos de stock', allowed: false },
        ],
      },
      {
        label: 'Administración',
        items: [
          { text: 'Gestionar usuarios o invitar nuevos', allowed: false },
          { text: 'Configurar contratos o empresa', allowed: false },
          { text: 'Editar catálogos maestros', allowed: false },
        ],
      },
    ],
  },
  SUPERVISOR: {
    summary: 'Responsable operacional. Puede gestionar mantenimiento e inventario, pero no la administración del tenant.',
    groups: [
      {
        label: 'Órdenes de Trabajo',
        items: [
          { text: 'Ver, crear y cerrar órdenes', allowed: true },
          { text: 'Reasignar y gestionar prioridades', allowed: true },
          { text: 'Eliminar órdenes', allowed: false },
        ],
      },
      {
        label: 'Mantenimiento e Inventario',
        items: [
          { text: 'Configurar pautas PM (kits)', allowed: true },
          { text: 'Gestionar catálogo de repuestos', allowed: true },
          { text: 'Gestionar bodegas y movimientos de stock', allowed: true },
          { text: 'Registrar y ajustar inventario', allowed: true },
        ],
      },
      {
        label: 'Administración',
        items: [
          { text: 'Gestionar usuarios o invitar nuevos', allowed: false },
          { text: 'Configurar contratos o empresa', allowed: false },
          { text: 'Editar catálogos maestros del sistema', allowed: false },
        ],
      },
    ],
  },
  ADMIN: {
    summary: 'Control total sobre el tenant. Puede gestionar todos los recursos, usuarios y configuración.',
    groups: [
      {
        label: 'Órdenes, Flota e Inventario',
        items: [
          { text: 'Acceso completo (crear, editar, eliminar)', allowed: true },
          { text: 'Ver reportes y exportar datos', allowed: true },
        ],
      },
      {
        label: 'Administración del Tenant',
        items: [
          { text: 'Invitar y gestionar usuarios', allowed: true },
          { text: 'Asignar roles y contratos', allowed: true },
          { text: 'Configurar empresa, logo y tema', allowed: true },
          { text: 'Gestionar maestro de contratos', allowed: true },
          { text: 'Editar catálogos maestros', allowed: true },
        ],
      },
      {
        label: 'Límites',
        items: [
          { text: 'Gestionar otros tenants', allowed: false },
          { text: 'Acceder al panel SUPER_ADMIN', allowed: false },
        ],
      },
    ],
  },
};

interface NavRow {
  label: string;
  section: string;
  route: string;
}

function buildNavRows(): NavRow[] {
  const rows: NavRow[] = [];
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      rows.push({ label: item.label, section: section.label, route: item.route });
    }
  }
  return rows;
}

/** Default routes per role from nav.config (used when no sidebarPermissions override). */
function buildDefaultRoutes(role: BaseRole): Set<string> {
  const routes = new Set<string>();
  for (const section of NAV_SECTIONS) {
    const sectionOk = !section.roles || section.roles.includes(role);
    for (const item of section.items) {
      const itemOk = !item.roles || item.roles.includes(role);
      if (sectionOk && itemOk) routes.add(item.route);
    }
  }
  return routes;
}

@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="space-y-6 animate-fade-in pb-10">

      <!-- ── Header ──────────────────────────────────────────────── -->
      <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4
                     bg-surface p-6 rounded-2xl shadow-lg border border-border backdrop-blur-xl">
        <div>
          <h1 class="text-2xl font-extrabold text-main tracking-tight flex items-center gap-3">
            <svg class="w-7 h-7 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
            </svg>
            Roles y Permisos
          </h1>
          <p class="text-muted mt-1 font-mono text-sm">
            Configura los módulos visibles para cada rol en el menú lateral.
          </p>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <button (click)="openCreateModal()"
                  class="flex items-center gap-2 text-xs font-mono bg-primary text-dark
                         font-bold px-4 py-2 rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
            </svg>
            Crear rol
          </button>
          <a routerLink="/app/usuarios"
             class="flex items-center gap-2 text-xs bg-dark border border-border hover:border-primary
                    text-muted hover:text-primary py-2 px-4 rounded-lg transition-colors font-mono">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
            </svg>
            Usuarios
          </a>
        </div>
      </header>

      <!-- ── Tabs ─────────────────────────────────────────────────── -->
      <div class="flex gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        <button (click)="activeTab.set('system')"
                class="text-xs font-mono px-4 py-2 rounded-lg transition-all"
                [class]="activeTab() === 'system'
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted hover:text-main'">
          Roles del sistema
        </button>
        <button (click)="activeTab.set('custom'); loadCustomRoles()"
                class="text-xs font-mono px-4 py-2 rounded-lg transition-all flex items-center gap-2"
                [class]="activeTab() === 'custom'
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted hover:text-main'">
          Roles personalizados
          @if (customRoles().length > 0) {
            <span class="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold
                         flex items-center justify-center">
              {{ customRoles().length }}
            </span>
          }
        </button>
      </div>

      <!-- ══ TAB: ROLES DEL SISTEMA ══════════════════════════════════ -->
      @if (activeTab() === 'system') {

        <p class="text-xs text-muted font-mono -mb-2">
          Haz clic en <strong class="text-main">Editar permisos</strong> para personalizar
          qué módulos ve cada rol en el menú lateral.
        </p>

        <div class="space-y-4">
          @for (role of systemRoles; track role) {
            <div class="bg-surface rounded-xl border transition-colors shadow-sm overflow-hidden
                        {{ ROLE_ACCENT[role] }}">

              <!-- Role header row -->
              <div class="flex items-start sm:items-center justify-between gap-4 p-5 flex-col sm:flex-row">
                <div class="flex items-center gap-4 min-w-0">
                  <!-- Avatar / icon -->
                  <div class="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-sm font-bold
                               {{ BADGE_CLASSES[role] }}">
                    {{ role.charAt(0) }}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-semibold text-main">{{ roleLabels[role] }}</span>
                      <span class="text-[10px] font-mono px-2 py-0.5 rounded-full border
                                   {{ BADGE_CLASSES[role] }}">
                        {{ role }}
                      </span>
                      @if (isLoadingUsers()) {
                        <span class="h-4 w-12 rounded bg-dark animate-pulse"></span>
                      } @else {
                        <span class="text-[10px] font-mono text-muted/60">
                          {{ userCounts()[role] ?? 0 }} usuario(s)
                        </span>
                      }
                    </div>
                    <p class="text-xs text-muted mt-0.5 leading-relaxed">
                      {{ roleDescriptions[role] }}
                    </p>
                  </div>
                </div>

                <button (click)="openSystemRoleModal(role)"
                        class="shrink-0 flex items-center gap-2 text-xs font-mono px-3.5 py-1.5
                               rounded-lg border border-border hover:border-primary/50 text-muted
                               hover:text-primary bg-dark transition-all">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                  Editar permisos
                </button>
              </div>

              <!-- Accessible modules + collapsible API panel -->
              <div class="border-t border-border/50 px-5 py-3 bg-dark/30">
                <div class="flex items-center justify-between mb-2">
                  <p class="text-[10px] font-mono text-muted/50 uppercase tracking-wider">
                    Menú lateral
                    ({{ getSystemRoleRoutes(role).length }}/{{ navRows.length }} módulos)
                  </p>
                  <button (click)="toggleApiPanel(role)"
                          class="text-[10px] font-mono text-muted/60 hover:text-primary transition-colors
                                 flex items-center gap-1">
                    <svg class="w-3 h-3 transition-transform"
                         [class.rotate-180]="expandedApiPanel() === role"
                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                    </svg>
                    {{ expandedApiPanel() === role ? 'Ocultar' : 'Ver' }} permisos de API
                  </button>
                </div>

                @if (getSystemRoleRoutes(role).length === 0) {
                  <p class="text-xs text-muted/50 italic">Sin acceso a ningún módulo.</p>
                } @else {
                  <div class="flex flex-wrap gap-1.5">
                    @for (route of getSystemRoleRoutes(role); track route) {
                      <span class="text-[10px] font-mono bg-dark border border-border/60
                                   px-2 py-0.5 rounded-md text-muted">
                        {{ getModuleLabel(route) }}
                      </span>
                    }
                  </div>
                }

                <!-- Collapsible API permissions panel -->
                @if (expandedApiPanel() === role) {
                  <div class="mt-3 rounded-xl border border-border/60 overflow-hidden">
                    <div class="px-4 py-2.5 bg-dark/60 border-b border-border/40">
                      <p class="text-[10px] font-mono font-bold text-muted uppercase tracking-wider">
                        Permisos de servidor (API)
                      </p>
                      <p class="text-[10px] text-muted/60 mt-0.5 leading-relaxed">
                        {{ baseRoleApi[role].summary }}
                      </p>
                    </div>
                    <div class="divide-y divide-border/30 bg-dark/20">
                      @for (group of baseRoleApi[role].groups; track group.label) {
                        <div class="px-4 py-3">
                          <p class="text-[10px] font-mono text-muted/50 uppercase tracking-wider mb-2">
                            {{ group.label }}
                          </p>
                          <ul class="space-y-1.5">
                            @for (item of group.items; track item.text) {
                              <li class="flex items-center gap-2 text-xs">
                                @if (item.allowed) {
                                  <svg class="w-3.5 h-3.5 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                                  </svg>
                                  <span class="text-main/80">{{ item.text }}</span>
                                } @else {
                                  <svg class="w-3.5 h-3.5 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                  </svg>
                                  <span class="text-muted/50">{{ item.text }}</span>
                                }
                              </li>
                            }
                          </ul>
                        </div>
                      }
                    </div>
                    <div class="px-4 py-2 border-t border-border/40 bg-amber-500/5">
                      <p class="text-[10px] text-amber-400/80 font-mono">
                        ⚠ Estos permisos son fijos del servidor y no se pueden modificar desde aquí.
                      </p>
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        <!-- SUPER_ADMIN note -->
        <div class="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 flex gap-3 items-start">
          <svg class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="text-xs text-purple-300/80 leading-relaxed">
            <strong class="text-purple-200">SUPER_ADMIN</strong> siempre tiene acceso completo al sistema
            y no requiere configuración de permisos.
            Los cambios aquí solo afectan la visibilidad del menú lateral,
            los permisos de la API no cambian.
          </p>
        </div>
      }

      <!-- ══ TAB: ROLES PERSONALIZADOS ═══════════════════════════════ -->
      @if (activeTab() === 'custom') {

        @if (isLoadingRoles()) {
          <div class="flex items-center justify-center py-12 text-muted font-mono text-sm">
            <svg class="w-5 h-5 animate-spin mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Cargando roles...
          </div>
        } @else if (customRoles().length === 0) {
          <div class="flex flex-col items-center justify-center py-16 text-center">
            <svg class="w-12 h-12 text-muted/30 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
            </svg>
            <p class="text-muted font-mono text-sm">No hay roles personalizados aún.</p>
            <p class="text-muted/60 text-xs mt-1">Crea un rol con permisos específicos para tu organización.</p>
            <button (click)="openCreateModal()"
                    class="mt-5 text-xs font-mono bg-primary text-dark font-bold px-4 py-2 rounded-lg
                           hover:bg-primary/90 transition-all flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
              </svg>
              Crear primer rol
            </button>
          </div>
        } @else {
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            @for (role of customRoles(); track role.id) {
              <div class="bg-surface rounded-xl border border-border p-5 flex flex-col gap-4
                          hover:border-primary/30 transition-colors shadow-sm">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-semibold text-main text-base">{{ role.name }}</span>
                      <span class="text-[10px] font-mono px-2 py-0.5 rounded-full border
                                   {{ BASE_ROLE_BADGE[role.baseRole] }}">
                        Base: {{ role.baseRole }}
                      </span>
                    </div>
                    @if (role.description) {
                      <p class="text-xs text-muted mt-1 leading-relaxed">{{ role.description }}</p>
                    }
                    <p class="text-[10px] font-mono text-muted/50 mt-1">
                      {{ role._count?.users ?? 0 }} usuario(s) asignado(s)
                    </p>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button (click)="openEditCustomModal(role)" title="Editar"
                            class="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                      </svg>
                    </button>
                    <button (click)="deleteRole(role)" title="Eliminar"
                            class="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </div>
                </div>

                <div>
                  <p class="text-[10px] font-mono text-muted/60 uppercase tracking-wider mb-1.5">
                    Módulos con acceso ({{ role.routes.length }})
                  </p>
                  @if (role.routes.length === 0) {
                    <p class="text-xs text-muted italic">Sin acceso a ningún módulo.</p>
                  } @else {
                    <div class="flex flex-wrap gap-1.5">
                      @for (route of role.routes; track route) {
                        <span class="text-[10px] font-mono bg-dark border border-border px-2 py-0.5 rounded-md text-muted">
                          {{ getModuleLabel(route) }}
                        </span>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      }

    </div>

    <!-- ══════════════════════════════════════════════════════════════ -->
    <!-- MODAL UNIFICADO                                                -->
    <!-- ══════════════════════════════════════════════════════════════ -->
    @if (modalOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4"
           (click)="closeModal()">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
        <div class="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-2xl
                    max-h-[90vh] flex flex-col animate-fade-in"
             (click)="$event.stopPropagation()">

          <!-- Modal header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <h2 class="font-bold text-main flex items-center gap-2">
              <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
              </svg>
              {{ modalTitle() }}
            </h2>
            <button (click)="closeModal()"
                    class="p-1.5 rounded-lg text-muted hover:text-main hover:bg-dark transition-colors">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <!-- Modal body -->
          <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            <!-- ── Custom role fields (create / edit-custom) ── -->
            @if (modalMode() !== 'system-edit') {

              <div>
                <label class="block text-xs font-mono text-muted mb-1.5 uppercase tracking-wider">
                  Nombre del rol *
                </label>
                <input type="text" [formControl]="modalForm.controls['name']"
                       placeholder="Ej: Técnico Junior, Bodeguero, Jefe de Planta..."
                       class="w-full bg-dark border border-border rounded-lg px-3 py-2 text-sm text-main
                              focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30
                              placeholder:text-muted/40 transition-colors" />
                @if (modalForm.controls['name'].invalid && modalForm.controls['name'].touched) {
                  <p class="text-xs text-red-400 mt-1 font-mono">El nombre es obligatorio.</p>
                }
              </div>

              <div>
                <label class="block text-xs font-mono text-muted mb-1.5 uppercase tracking-wider">
                  Descripción
                </label>
                <input type="text" [formControl]="modalForm.controls['description']"
                       placeholder="Describe las responsabilidades de este rol..."
                       class="w-full bg-dark border border-border rounded-lg px-3 py-2 text-sm text-main
                              focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30
                              placeholder:text-muted/40 transition-colors" />
              </div>

              <div class="space-y-3">
                <label class="block text-xs font-mono text-muted mb-1.5 uppercase tracking-wider">
                  Rol base (permisos de servidor) *
                </label>

                <!-- Selector -->
                <div class="grid grid-cols-3 gap-2">
                  @for (r of baseRoles; track r) {
                    <button type="button"
                            (click)="modalForm.controls['baseRole'].setValue(r)"
                            class="py-2 px-3 rounded-lg border text-xs font-mono font-semibold transition-all"
                            [class]="modalForm.controls['baseRole'].value === r
                              ? 'bg-primary/15 text-primary border-primary/50 shadow-sm'
                              : 'bg-dark border-border text-muted hover:border-primary/30 hover:text-main'">
                      {{ r }}
                    </button>
                  }
                </div>

                <!-- API permissions panel for selected base role -->
                @if (modalForm.controls['baseRole'].value) {
                  <div class="rounded-xl border border-border/60 bg-dark overflow-hidden">
                    <!-- Header -->
                    <div class="px-4 py-2.5 border-b border-border/40 flex items-start gap-2.5 bg-dark/60">
                      <svg class="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"/>
                      </svg>
                      <div>
                        <p class="text-[10px] font-mono font-bold text-muted uppercase tracking-wider">
                          Permisos de API — {{ modalForm.controls['baseRole'].value }}
                        </p>
                        <p class="text-[10px] text-muted/60 mt-0.5 leading-relaxed">
                          {{ baseRoleApi[modalForm.controls['baseRole'].value].summary }}
                        </p>
                      </div>
                    </div>

                    <!-- Groups -->
                    <div class="divide-y divide-border/30">
                      @for (group of baseRoleApi[modalForm.controls['baseRole'].value].groups; track group.label) {
                        <div class="px-4 py-3">
                          <p class="text-[10px] font-mono text-muted/50 uppercase tracking-wider mb-2">
                            {{ group.label }}
                          </p>
                          <ul class="space-y-1">
                            @for (item of group.items; track item.text) {
                              <li class="flex items-center gap-2 text-xs">
                                @if (item.allowed) {
                                  <svg class="w-3.5 h-3.5 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                                  </svg>
                                  <span class="text-main/80">{{ item.text }}</span>
                                } @else {
                                  <svg class="w-3.5 h-3.5 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                  </svg>
                                  <span class="text-muted/50">{{ item.text }}</span>
                                }
                              </li>
                            }
                          </ul>
                        </div>
                      }
                    </div>

                    <div class="px-4 py-2.5 border-t border-border/40 bg-amber-500/5">
                      <p class="text-[10px] text-amber-400/80 font-mono leading-relaxed">
                        ⚠ Estos permisos son fijos del servidor y no se pueden cambiar desde aquí.
                        El selector de módulos de abajo solo controla qué aparece en el menú lateral.
                      </p>
                    </div>
                  </div>
                }
              </div>

              <hr class="border-border/40" />
            }

            <!-- ── Info banner for system-edit mode ── -->
            @if (modalMode() === 'system-edit') {
              <div class="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <span class="inline-block text-[10px] font-mono font-bold px-2.5 py-1 rounded-full uppercase
                             tracking-wider {{ BADGE_CLASSES[editingSystemRole()!] }}">
                  {{ editingSystemRole() }}
                </span>
                <p class="text-xs text-muted leading-relaxed">
                  {{ roleDescriptions[editingSystemRole()!] }}
                </p>
              </div>
            }

            <!-- ── Route selector (all modes) ── -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="text-xs font-mono text-muted uppercase tracking-wider">
                  Módulos con acceso
                </label>
                <div class="flex gap-2">
                  <button type="button" (click)="selectAllRoutes()"
                          class="text-[10px] font-mono text-muted hover:text-primary transition-colors px-2 py-1
                                 border border-border rounded hover:border-primary/30">
                    Seleccionar todo
                  </button>
                  <button type="button" (click)="clearAllRoutes()"
                          class="text-[10px] font-mono text-muted hover:text-red-400 transition-colors px-2 py-1
                                 border border-border rounded hover:border-red-500/30">
                    Limpiar
                  </button>
                </div>
              </div>
              <div class="bg-dark border border-border rounded-xl overflow-hidden divide-y divide-border/40">
                @for (section of navSections; track section.label) {
                  <div>
                    <p class="px-4 py-2 text-[10px] font-mono text-muted/60 uppercase tracking-wider bg-dark/50">
                      {{ section.label }}
                    </p>
                    @for (item of section.items; track item.route) {
                      <label class="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 cursor-pointer
                                    transition-colors group">
                        <div class="relative shrink-0">
                          <input type="checkbox"
                                 [checked]="isRouteSelected(item.route)"
                                 (change)="toggleRoute(item.route)"
                                 class="sr-only" />
                          <div class="w-4 h-4 rounded border transition-all"
                               [class]="isRouteSelected(item.route)
                                 ? 'bg-primary border-primary'
                                 : 'border-border group-hover:border-primary/50'">
                            @if (isRouteSelected(item.route)) {
                              <svg class="w-4 h-4 text-dark p-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                              </svg>
                            }
                          </div>
                        </div>
                        <span class="text-sm text-main">{{ item.label }}</span>
                        <span class="text-[10px] font-mono text-muted/50 ml-auto">{{ item.route }}</span>
                      </label>
                    }
                  </div>
                }
              </div>
              <p class="text-[10px] font-mono text-muted/50 mt-1.5">
                {{ selectedRoutesCount() }} de {{ navRows.length }} módulos seleccionados
              </p>
            </div>

          </div>

          <!-- Modal footer -->
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
            <button (click)="closeModal()"
                    class="text-xs font-mono px-4 py-2 rounded-lg border border-border
                           text-muted hover:text-main hover:border-primary/40 transition-all">
              Cancelar
            </button>
            <button (click)="saveModal()"
                    [disabled]="isSavingRole() || (modalMode() !== 'system-edit' && modalForm.invalid)"
                    class="text-xs font-mono px-5 py-2 rounded-lg transition-all font-semibold
                           flex items-center gap-2"
                    [class]="(modalMode() === 'system-edit' || modalForm.valid)
                      ? 'bg-primary text-dark hover:bg-primary/90 shadow-lg shadow-primary/20'
                      : 'bg-dark border border-border text-muted cursor-not-allowed'">
              @if (isSavingRole()) {
                <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              }
              {{ isSavingRole() ? 'Guardando...' : modalMode() === 'custom-create' ? 'Crear rol' : 'Guardar cambios' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class RolesComponent implements OnInit {
  private usersService = inject(UsersService);
  private tenantService = inject(TenantService);
  private tenantRolesService = inject(TenantRolesService);
  private notif = inject(NotificationService);
  private fb = inject(FormBuilder);

  readonly BADGE_CLASSES = BADGE_CLASSES;
  readonly BASE_ROLE_BADGE = BASE_ROLE_BADGE;
  readonly ROLE_ACCENT = ROLE_ACCENT;
  readonly systemRoles = SYSTEM_ROLES;
  readonly navRows: NavRow[] = buildNavRows();
  readonly navSections = NAV_SECTIONS;
  readonly baseRoles: BaseRole[] = ['MECHANIC', 'SUPERVISOR', 'ADMIN'];
  readonly roleLabels = ROLE_LABELS;
  readonly roleDescriptions = ROLE_DESCRIPTIONS;
  readonly baseRoleApi = BASE_ROLE_API;

  activeTab = signal<'system' | 'custom'>('system');
  isLoadingUsers = signal(true);
  isLoadingRoles = signal(false);
  isSavingRole = signal(false);

  /** Which system role card has the API panel expanded (null = none). */
  expandedApiPanel = signal<BaseRole | null>(null);

  toggleApiPanel(role: BaseRole): void {
    this.expandedApiPanel.update((v) => (v === role ? null : role));
  }

  // Modal state
  modalOpen = signal(false);
  modalMode = signal<ModalMode>('custom-create');
  editingCustomRole = signal<TenantRole | null>(null);
  editingSystemRole = signal<BaseRole | null>(null);

  customRoles = signal<TenantRole[]>([]);
  userCounts = signal<Partial<Record<AppRole, number>>>({});

  modalForm = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: [''],
    baseRole: ['MECHANIC' as BaseRole, Validators.required],
  });

  selectedRoutes = signal<Set<string>>(new Set());
  selectedRoutesCount = computed(() => this.selectedRoutes().size);

  modalTitle = computed(() => {
    switch (this.modalMode()) {
      case 'system-edit':
        return `Permisos de ${ROLE_LABELS[this.editingSystemRole()!] ?? this.editingSystemRole()}`;
      case 'custom-edit':
        return `Editar: ${this.editingCustomRole()?.name}`;
      default:
        return 'Crear nuevo rol';
    }
  });

  // ── Route helpers ──────────────────────────────────────────────

  getModuleLabel(route: string): string {
    for (const section of NAV_SECTIONS) {
      const item = section.items.find((i) => i.route === route);
      if (item) return item.label;
    }
    return route;
  }

  /** Returns the current allowed routes for a system role (from overrides or defaults). */
  getSystemRoleRoutes(role: BaseRole): string[] {
    const perms = this.tenantService.currentTenant()?.sidebarPermissions;
    if (perms && perms[role]) return perms[role];
    return Array.from(buildDefaultRoutes(role));
  }

  isRouteSelected(route: string): boolean {
    return this.selectedRoutes().has(route);
  }

  toggleRoute(route: string): void {
    this.selectedRoutes.update((set) => {
      const next = new Set(set);
      next.has(route) ? next.delete(route) : next.add(route);
      return next;
    });
  }

  selectAllRoutes(): void {
    this.selectedRoutes.set(new Set(this.navRows.map((r) => r.route)));
  }

  clearAllRoutes(): void {
    this.selectedRoutes.set(new Set());
  }

  // ── Modal open/close ─────────────────────────────────────────

  openCreateModal(): void {
    this.editingCustomRole.set(null);
    this.editingSystemRole.set(null);
    this.modalMode.set('custom-create');
    this.modalForm.reset({ name: '', description: '', baseRole: 'MECHANIC' });
    this.selectedRoutes.set(new Set());
    this.modalOpen.set(true);
    if (this.activeTab() !== 'custom') {
      this.activeTab.set('custom');
      this.loadCustomRoles();
    }
  }

  openEditCustomModal(role: TenantRole): void {
    this.editingCustomRole.set(role);
    this.editingSystemRole.set(null);
    this.modalMode.set('custom-edit');
    this.modalForm.setValue({
      name: role.name,
      description: role.description ?? '',
      baseRole: role.baseRole,
    });
    this.selectedRoutes.set(new Set(role.routes));
    this.modalOpen.set(true);
  }

  openSystemRoleModal(role: BaseRole): void {
    this.editingSystemRole.set(role);
    this.editingCustomRole.set(null);
    this.modalMode.set('system-edit');
    this.selectedRoutes.set(new Set(this.getSystemRoleRoutes(role)));
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingCustomRole.set(null);
    this.editingSystemRole.set(null);
  }

  // ── Save ────────────────────────────────────────────────────

  saveModal(): void {
    if (this.isSavingRole()) return;
    if (this.modalMode() === 'system-edit') {
      this.saveSystemRolePermissions();
    } else {
      this.saveCustomRole();
    }
  }

  private saveSystemRolePermissions(): void {
    const role = this.editingSystemRole();
    if (!role) return;
    this.isSavingRole.set(true);

    const current = this.tenantService.currentTenant();
    const existing: Record<string, string[]> =
      (current?.sidebarPermissions as Record<string, string[]>) ?? {};

    const updated: Record<string, string[]> = {
      ...existing,
      [role]: Array.from(this.selectedRoutes()),
    };

    this.tenantService.updateTenantConfig({ sidebarPermissions: updated }).subscribe({
      next: (res) => {
        this.tenantService.setTenant({ ...current!, ...res, sidebarPermissions: updated });
        this.isSavingRole.set(false);
        this.notif.success(`Permisos de ${ROLE_LABELS[role]} actualizados.`);
        this.closeModal();
      },
      error: () => {
        this.isSavingRole.set(false);
        this.notif.error('Error al guardar los permisos.');
      },
    });
  }

  private saveCustomRole(): void {
    if (this.modalForm.invalid) return;
    this.isSavingRole.set(true);
    const { name, description, baseRole } = this.modalForm.value;
    const payload = {
      name: name!,
      description: description || undefined,
      baseRole: baseRole as BaseRole,
      routes: Array.from(this.selectedRoutes()),
    };

    const editing = this.editingCustomRole();
    const obs = editing
      ? this.tenantRolesService.update(editing.id, payload)
      : this.tenantRolesService.create(payload);

    obs.subscribe({
      next: (saved) => {
        if (editing) {
          this.customRoles.update((roles) => roles.map((r) => (r.id === saved.id ? saved : r)));
          this.notif.success('Rol actualizado correctamente.');
        } else {
          this.customRoles.update((roles) => [...roles, saved]);
          this.notif.success('Rol creado correctamente.');
        }
        this.syncTenantRoles();
        this.isSavingRole.set(false);
        this.closeModal();
      },
      error: (err) => {
        this.isSavingRole.set(false);
        const msg = err?.error?.message ?? 'Error al guardar el rol.';
        this.notif.error(Array.isArray(msg) ? msg.join(', ') : msg);
      },
    });
  }

  deleteRole(role: TenantRole): void {
    if (!confirm(`¿Eliminar el rol "${role.name}"? Los usuarios asignados quedarán sin rol personalizado.`)) {
      return;
    }
    this.tenantRolesService.remove(role.id).subscribe({
      next: () => {
        this.customRoles.update((roles) => roles.filter((r) => r.id !== role.id));
        this.syncTenantRoles();
        this.notif.success('Rol eliminado correctamente.');
      },
      error: () => this.notif.error('Error al eliminar el rol.'),
    });
  }

  loadCustomRoles(): void {
    if (this.isLoadingRoles()) return;
    this.isLoadingRoles.set(true);
    this.tenantRolesService.getAll().subscribe({
      next: (roles) => {
        this.customRoles.set(roles);
        this.syncTenantRoles();
        this.isLoadingRoles.set(false);
      },
      error: () => this.isLoadingRoles.set(false),
    });
  }

  private syncTenantRoles(): void {
    const current = this.tenantService.currentTenant();
    if (current) {
      this.tenantService.setTenant({
        ...current,
        tenantRoles: this.customRoles().map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          baseRole: r.baseRole,
          routes: r.routes,
        })),
      });
    }
  }

  ngOnInit(): void {
    this.usersService.getUsers(1, 200).subscribe({
      next: ({ items }) => {
        const counts: Partial<Record<AppRole, number>> = {};
        for (const u of items) {
          const r = u.role as AppRole;
          counts[r] = (counts[r] ?? 0) + 1;
        }
        this.userCounts.set(counts);
        this.isLoadingUsers.set(false);
      },
      error: () => this.isLoadingUsers.set(false),
    });

    const tenantRoles = this.tenantService.currentTenant()?.tenantRoles;
    if (tenantRoles) {
      this.customRoles.set(
        tenantRoles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          baseRole: r.baseRole as BaseRole,
          routes: r.routes,
        }))
      );
    }
  }
}
