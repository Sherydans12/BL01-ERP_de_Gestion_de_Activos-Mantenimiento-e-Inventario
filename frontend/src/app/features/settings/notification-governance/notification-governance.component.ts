import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, forkJoin, switchMap } from 'rxjs';
import { NotificationSettingsService } from '../../../core/services/notification-settings/notification-settings.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { UsersService, UserSearchSuggestion } from '../../../core/services/users/users.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { A } from '../../../core/constants/admin-permissions';
import type {
  TenantNotificationSetting,
  UserSubscriptionRow,
  UserNotificationSettingWithUser,
  NotificationEventKey,
} from '../../../core/models/notification-settings.interface';

// ── Catálogo de eventos agrupado por módulo ──────────────────────────────────

export interface EventDef {
  key: NotificationEventKey;
  label: string;
  description: string;
}

export interface EventGroup {
  module: string;
  icon: string;
  events: EventDef[];
}

export const EVENT_GROUPS: EventGroup[] = [
  {
    module: 'Compras',
    icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    events: [
      {
        key: 'PURCHASE_REQUISITION_CREATED',
        label: 'Requerimiento de compra creado',
        description: 'Notifica cuando se genera un nuevo SRC pendiente de gestión.',
      },
      {
        key: 'PURCHASE_REQUISITION_DRAFT_CREATED',
        label: 'Borrador de SRC guardado',
        description: 'Aviso temprano al Jefe de Compras cuando se guarda un SRC como DRAFT.',
      },
      {
        key: 'PURCHASE_REQUISITION_SUBMITTED',
        label: 'SRC emitido formalmente',
        description: 'Notifica al Jefe de Compras cuando un SRC pasa a estado SUBMITTED.',
      },
      {
        key: 'PURCHASE_PO_PENDING_SIGNATURE',
        label: 'OC pendiente de firma',
        description: 'Notifica al siguiente firmante cuando una OC requiere aprobación.',
      },
      {
        key: 'PURCHASE_PO_BATCH_SIGNATURE',
        label: 'Lote de OC pendientes',
        description: 'Resumen de varias OC generadas en batch que esperan firma.',
      },
      {
        key: 'INVOICE_DISCREPANCY',
        label: 'Discrepancia en factura',
        description: 'Alerta cuando el 3-way match detecta diferencias en una factura.',
      },
    ],
  },
  {
    module: 'Usuarios / Auth',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    events: [
      {
        key: 'USER_INVITE',
        label: 'Invitación de usuario',
        description: 'Correo de bienvenida enviado al dar de alta un nuevo usuario.',
      },
      {
        key: 'USER_RESEND_ACTIVATION',
        label: 'Reenvío de activación',
        description: 'Segundo envío del enlace de activación de cuenta.',
      },
      {
        key: 'AUTH_FORGOT_PASSWORD',
        label: 'Recuperación de contraseña',
        description: 'Enlace de reset enviado cuando el usuario lo solicita.',
      },
      {
        key: 'AUTH_UNUSUAL_LOGIN',
        label: 'Acceso inusual detectado',
        description: 'Alerta de seguridad cuando un login difiere de la IP o país habitual.',
      },
    ],
  },
  {
    module: 'Mantenimiento',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    events: [
      {
        key: 'OT_WARRANTY_NOTIFY',
        label: 'Garantía en OT',
        description: 'Notifica a la lista externa cuando se cierra una OT con posible garantía.',
      },
    ],
  },
  {
    module: 'Inventario',
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
    events: [
      {
        key: 'INVENTORY_STOCK_MIN',
        label: 'Stock mínimo alcanzado',
        description: 'Alerta cuando un artículo cae por debajo de su stock mínimo definido.',
      },
      {
        key: 'INVENTORY_ITEM_CREATED',
        label: 'Nuevo artículo en catálogo',
        description:
          'Correo al dar de alta un artículo (maestro o quick-create). Requiere evento activado; destinatarios: suscriptores con canal EMAIL en la matriz y/o correos en «CC externos».',
      },
    ],
  },
];

// ── Componente ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-notification-governance',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './notification-governance.component.html',
})
export class NotificationGovernanceComponent implements OnInit {
  private readonly notifSettingsService = inject(NotificationSettingsService);
  private readonly notifToast = inject(NotificationService);
  private readonly usersService = inject(UsersService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authService = inject(AuthService);

  readonly canManageSettings = computed(() =>
    this.authService.hasPermission(A.NOTIFICATION_MANAGE_SETTINGS),
  );

  // ── Estado ──────────────────────────────────────────────────────────────
  readonly eventGroups = EVENT_GROUPS;
  readonly selectedEventKey = signal<NotificationEventKey>('PURCHASE_REQUISITION_CREATED');
  /** Módulos con acordeón expandido. Todos abiertos por defecto. */
  readonly expandedModules = signal<Set<string>>(
    new Set(EVENT_GROUPS.map((g) => g.module)),
  );

  readonly tenantSettings = signal<TenantNotificationSetting[]>([]);
  readonly subscribers = signal<UserNotificationSettingWithUser[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);

  // Subject que cancela peticiones anteriores (switchMap) al cambiar de evento
  private readonly loadTrigger$ = new Subject<NotificationEventKey>();

  // Búsqueda de usuario para agregar
  readonly userSearchQuery = signal('');
  readonly userSuggestions = signal<UserSearchSuggestion[]>([]);
  readonly showSuggestions = signal(false);

  // CC email input
  readonly ccEmailInput = signal('');

  // ── Computed ─────────────────────────────────────────────────────────────

  /** Configuración del tenant para el evento seleccionado. */
  readonly currentTenantSetting = computed<TenantNotificationSetting | null>(
    () =>
      this.tenantSettings().find(
        (s) => s.eventKey === this.selectedEventKey(),
      ) ?? null,
  );

  /** Master switch: si no hay registro, el evento está activo por defecto (tenant). */
  readonly tenantEventEnabled = computed(
    () => this.currentTenantSetting()?.enabled ?? true,
  );

  readonly tenantCcEmails = computed(
    () => this.currentTenantSetting()?.ccEmails ?? [],
  );

  /** Definición del evento seleccionado. */
  readonly currentEventDef = computed(
    () =>
      EVENT_GROUPS.flatMap((g) => g.events).find(
        (e) => e.key === this.selectedEventKey(),
      ) ?? null,
  );

  /**
   * Matriz de usuarios: una fila por userId con estado de cada canal.
   * Solo incluye usuarios con al menos un canal activo (opt-in estricto).
   */
  readonly subscriberMatrix = computed<UserSubscriptionRow[]>(() => {
    const subs = this.subscribers();
    const byUser = new Map<string, UserSubscriptionRow>();

    for (const sub of subs) {
      if (!byUser.has(sub.userId)) {
        byUser.set(sub.userId, {
          userId: sub.userId,
          name: sub.user.name,
          email: sub.user.email,
          role: sub.user.customRole?.name ?? sub.user.role,
          avatarUrl: sub.user.avatarUrl,
          customRole: sub.user.customRole,
          emailEnabled: false,
          pushEnabled: false,
        });
      }
      const row = byUser.get(sub.userId)!;
      if (sub.channel === 'EMAIL') row.emailEnabled = sub.enabled;
      if (sub.channel === 'WEB_PUSH') row.pushEnabled = sub.enabled;
    }

    // Filtra usuarios que no tienen ningún canal activo (eliminados localmente
    // o retornados por el backend con enabled=false)
    return Array.from(byUser.values())
      .filter((r) => r.emailEnabled || r.pushEnabled)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // ── Init: pipe switchMap que cancela peticiones obsoletas ────────────────

  ngOnInit() {
    this.loadTrigger$
      .pipe(
        switchMap((eventKey) => {
          this.loading.set(true);
          return forkJoin({
            tenantSettings: this.notifSettingsService.getTenantSettings(),
            subscribers: this.notifSettingsService.getEventSubscribers(eventKey),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ tenantSettings, subscribers }) => {
          this.tenantSettings.set(tenantSettings);
          this.subscribers.set(subscribers);
          this.loading.set(false);
        },
        error: () => {
          this.notifToast.error('Error al cargar la configuración del evento.');
          this.loading.set(false);
        },
      });

    // Carga inicial
    this.loadTrigger$.next(this.selectedEventKey());
  }

  // ── Métodos ──────────────────────────────────────────────────────────────

  selectEvent(key: NotificationEventKey) {
    this.selectedEventKey.set(key);
    this.loadTrigger$.next(key);
  }

  private reloadCurrentEvent() {
    this.loadTrigger$.next(this.selectedEventKey());
  }

  // ── Interruptor maestro del tenant ────────────────────────────────────────

  toggleTenantEvent(enabled: boolean) {
    this.saving.set(true);
    this.notifSettingsService
      .upsertTenantSetting({
        eventKey: this.selectedEventKey(),
        enabled,
        ccEmails: this.tenantCcEmails(),
      })
      .subscribe({
        next: (updated) => {
          this.tenantSettings.update((prev) => {
            const idx = prev.findIndex(
              (s) => s.eventKey === updated.eventKey,
            );
            return idx >= 0
              ? prev.map((s, i) => (i === idx ? updated : s))
              : [...prev, updated];
          });
          this.saving.set(false);
          this.notifToast.success(
            `Evento ${enabled ? 'activado' : 'desactivado'} para la empresa.`,
          );
        },
        error: () => {
          this.saving.set(false);
          this.notifToast.error('No se pudo actualizar la configuración.');
        },
      });
  }

  // ── CC emails chips ───────────────────────────────────────────────────────

  addCcEmail() {
    const email = this.ccEmailInput().trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    const current = this.tenantCcEmails();
    if (current.includes(email)) {
      this.ccEmailInput.set('');
      return;
    }
    const newList = [...current, email];
    this.saving.set(true);
    this.notifSettingsService
      .upsertTenantSetting({
        eventKey: this.selectedEventKey(),
        enabled: this.tenantEventEnabled(),
        ccEmails: newList,
      })
      .subscribe({
        next: (updated) => {
          this.patchTenantSetting(updated);
          this.ccEmailInput.set('');
          this.saving.set(false);
        },
        error: () => {
          this.saving.set(false);
          this.notifToast.error('No se pudo agregar el correo CC.');
        },
      });
  }

  removeCcEmail(email: string) {
    const newList = this.tenantCcEmails().filter((e) => e !== email);
    this.saving.set(true);
    this.notifSettingsService
      .upsertTenantSetting({
        eventKey: this.selectedEventKey(),
        enabled: this.tenantEventEnabled(),
        ccEmails: newList,
      })
      .subscribe({
        next: (updated) => {
          this.patchTenantSetting(updated);
          this.saving.set(false);
        },
        error: () => {
          this.saving.set(false);
          this.notifToast.error('No se pudo eliminar el correo CC.');
        },
      });
  }

  onCcKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addCcEmail();
    }
  }

  private patchTenantSetting(updated: TenantNotificationSetting) {
    this.tenantSettings.update((prev) => {
      const idx = prev.findIndex((s) => s.eventKey === updated.eventKey);
      return idx >= 0
        ? prev.map((s, i) => (i === idx ? updated : s))
        : [...prev, updated];
    });
  }

  // ── Toggle canal de usuario (RBAC delegado) ───────────────────────────────

  toggleUserChannel(
    userId: string,
    channel: 'EMAIL' | 'WEB_PUSH',
    currentEnabled: boolean,
  ) {
    const newEnabled = !currentEnabled;

    // Actualización optimista: actualiza si el registro existe en el signal.
    // Si no existe aún (canal nunca habilitado), lo añade sintéticamente para
    // que el toggle se refleje de inmediato; la recarga post-éxito lo normaliza.
    const existing = this.subscribers().find(
      (s) => s.userId === userId && s.channel === channel,
    );
    if (existing) {
      this.subscribers.update((prev) =>
        prev.map((s) =>
          s.userId === userId && s.channel === channel
            ? { ...s, enabled: newEnabled }
            : s,
        ),
      );
    } else {
      // Registro nuevo: clonar la data del otro canal del mismo usuario
      const peer = this.subscribers().find((s) => s.userId === userId);
      if (peer) {
        this.subscribers.update((prev) => [
          ...prev,
          { ...peer, id: `tmp-${channel}`, channel: channel as 'EMAIL' | 'WEB_PUSH', enabled: newEnabled },
        ]);
      }
    }

    this.notifSettingsService
      .upsertUserSetting({
        targetUserId: userId,
        eventKey: this.selectedEventKey(),
        channel,
        enabled: newEnabled,
      })
      .subscribe({
        next: () => {
          // Recarga desde el servidor para normalizar IDs y estado real
          this.reloadCurrentEvent();
        },
        error: () => {
          this.notifToast.error('No se pudo actualizar el canal del usuario.');
          // Revertir y recargar estado real
          this.reloadCurrentEvent();
        },
      });
  }

  // ── Agregar usuario al evento ─────────────────────────────────────────────

  onUserSearch(query: string) {
    this.userSearchQuery.set(query);
    if (query.trim().length < 2) {
      this.userSuggestions.set([]);
      this.showSuggestions.set(false);
      return;
    }
    this.usersService
      .getSearchSuggestions(query)
      .subscribe(({ items }) => {
        this.userSuggestions.set(items);
        this.showSuggestions.set(items.length > 0);
      });
  }

  addUserToEvent(suggestion: UserSearchSuggestion) {
    this.showSuggestions.set(false);
    this.userSearchQuery.set('');

    // Verificar si ya tiene al menos un canal activo para este evento
    const existing = this.subscribers().filter(
      (s) => s.userId === suggestion.id,
    );
    const hasEmail = existing.some(
      (s) => s.channel === 'EMAIL' && s.enabled,
    );
    const hasPush = existing.some(
      (s) => s.channel === 'WEB_PUSH' && s.enabled,
    );

    if (hasEmail && hasPush) {
      this.notifToast.info(
        `${suggestion.name} ya está suscrito a todos los canales para este evento.`,
      );
      return;
    }

    // Habilitar EMAIL por defecto si no tiene ningún canal
    const channel: 'EMAIL' | 'WEB_PUSH' = hasEmail ? 'WEB_PUSH' : 'EMAIL';

    this.notifSettingsService
      .upsertUserSetting({
        targetUserId: suggestion.id,
        eventKey: this.selectedEventKey(),
        channel,
        enabled: true,
      })
      .subscribe({
        next: () => {
          this.notifToast.success(
            `${suggestion.name} suscrito al canal ${channel === 'EMAIL' ? 'Email' : 'Web Push'}.`,
          );
          this.reloadCurrentEvent();
        },
        error: () => {
          this.notifToast.error('No se pudo agregar al usuario.');
        },
      });
  }

  // ── Eliminar usuario del evento (deshabilita todos sus canales) ───────────

  removeUserFromEvent(userId: string, userName: string) {
    const userSubs = this.subscribers().filter((s) => s.userId === userId);
    const calls = userSubs.map((s) =>
      this.notifSettingsService.upsertUserSetting({
        targetUserId: userId,
        eventKey: this.selectedEventKey(),
        channel: s.channel as 'EMAIL' | 'WEB_PUSH',
        enabled: false,
      }),
    );

    if (!calls.length) return;

    // Optimistic: quita al usuario de la matriz de inmediato
    this.subscribers.update((prev) =>
      prev.filter((s) => s.userId !== userId),
    );

    forkJoin(calls).subscribe({
      next: () => {
        this.notifToast.success(`${userName} eliminado del evento.`);
        // Recarga para confirmar estado real del servidor
        this.reloadCurrentEvent();
      },
      error: () => {
        this.notifToast.error('No se pudo eliminar al usuario.');
        // Revertir: recargar estado real
        this.reloadCurrentEvent();
      },
    });
  }

  toggleModule(module: string) {
    this.expandedModules.update((set) => {
      const next = new Set(set);
      next.has(module) ? next.delete(module) : next.add(module);
      return next;
    });
  }

  isModuleExpanded(module: string): boolean {
    return this.expandedModules().has(module);
  }

  trackByUserId(_: number, row: UserSubscriptionRow) {
    return row.userId;
  }

  trackByEmail(_: number, email: string) {
    return email;
  }

  getRoleInitial(role: string): string {
    return role.charAt(0).toUpperCase();
  }
}
