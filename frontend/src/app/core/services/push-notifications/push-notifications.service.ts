import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { EMPTY, from, Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

const APPROVER_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;
const SESSION_ATTEMPT_KEY = 'bl_push_subscribe_attempted';

interface PushNavAction {
  route: string[] | null;
  queryParams?: Record<string, string>;
}

/**
 * Web Push: suscripción con SwPush y registro en el backend.
 * (Las toasts in-app siguen en `NotificationService`.)
 */
@Injectable({
  providedIn: 'root',
})
export class PushNotificationsService {
  private readonly platformId = inject(PLATFORM_ID);
  private subscribeInFlight = false;

  constructor(
    private readonly swPush: SwPush,
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {
    if (isPlatformBrowser(this.platformId) && this.swPush.isEnabled) {
      this.swPush.notificationClicks.subscribe((event) => {
        const parsed = this.parsePushNotificationData(event.notification.data);
        void this.navigateFromPush(parsed).then(() =>
          this.dismissBrowserNotifications(),
        );
      });
    }
  }

  /**
   * Cierra notificaciones del sistema aún visibles (bandeja / centro de alertas)
   * tras navegar; el SW de Angular ya cerró la instancia en el clic, pero en
   * algunos navegadores conviene cerrar el resto asociadas al SW.
   */
  private async dismissBrowserNotifications(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.getNotifications === 'function') {
        const list = await reg.getNotifications();
        for (const n of list) {
          try {
            n.close();
          } catch {
            /* noop */
          }
        }
      }
    } catch {
      /* noop */
    }
  }

  /**
   * Parseado del payload push → estructura de navegación por tipo de evento.
   * Tipos soportados:
   *   - `PURCHASE_ORDER_PENDING_SIGNATURE`, `PURCHASE_ORDER_BATCH_PENDING_SIGNATURE`: → /compras/ordenes/:orderId
   *   - `INVOICE_DISCREPANCY`: → /compras/ordenes/:orderId?tab=billing
   *   - `EQUIPMENT_DOWN`: → /operaciones/fallas
   */
  parsePushNotificationData(data: unknown): PushNavAction {
    let raw: Record<string, unknown> | null = null;
    if (data == null) return { route: null };
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      raw = data as Record<string, unknown>;
    } else if (typeof data === 'string') {
      try {
        raw = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return { route: null };
      }
    } else {
      return { route: null };
    }

    const type = typeof raw['type'] === 'string' ? raw['type'] : null;
    const orderId = typeof raw['orderId'] === 'string' ? raw['orderId'] : null;

    if (type === 'EQUIPMENT_DOWN') {
      return { route: ['/app/operaciones/fallas'] };
    }
    if (type === 'INVOICE_DISCREPANCY' && orderId) {
      return { route: ['/app/compras/ordenes', orderId], queryParams: { tab: 'billing' } };
    }
    if (orderId) {
      return { route: ['/app/compras/ordenes', orderId] };
    }
    return { route: null };
  }

  private async navigateFromPush(action: PushNavAction): Promise<void> {
    if (!action.route) return;
    const extras = action.queryParams ? { queryParams: action.queryParams } : {};
    await this.router.navigate(action.route, extras);
  }

  static isApproverRole(role: string | undefined): boolean {
    if (!role) return false;
    return (APPROVER_ROLES as readonly string[]).includes(role);
  }

  /** `true` si el usuario bloqueó notificaciones para este origen. */
  static notificationsDenied(): boolean {
    return (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'denied'
    );
  }

  subscribeToNotifications(): Observable<void> {
    if (!isPlatformBrowser(this.platformId) || !this.swPush.isEnabled) {
      return EMPTY;
    }
    if (!environment.vapidPublicKey?.trim()) {
      return EMPTY;
    }

    return from(
      this.swPush.requestSubscription({
        serverPublicKey: environment.vapidPublicKey.trim(),
      }),
    ).pipe(
      switchMap((subscription) =>
        this.http.post<void>(
          `${environment.apiUrl}/notifications/subscribe`,
          subscription.toJSON(),
        ),
      ),
      map(() => undefined),
      catchError(() => EMPTY),
    );
  }

  maybeSubscribeOncePerSession(): void {
    if (!isPlatformBrowser(this.platformId) || !this.swPush.isEnabled) {
      return;
    }
    if (sessionStorage.getItem(SESSION_ATTEMPT_KEY) === '1') {
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      return;
    }
    if (this.subscribeInFlight) {
      return;
    }
    this.subscribeInFlight = true;

    this.subscribeToNotifications().subscribe({
      next: () => {
        sessionStorage.setItem(SESSION_ATTEMPT_KEY, '1');
        this.subscribeInFlight = false;
      },
      error: () => {
        this.subscribeInFlight = false;
      },
    });
  }

  debugRetrySubscribe(): void {
    sessionStorage.removeItem(SESSION_ATTEMPT_KEY);
    this.maybeSubscribeOncePerSession();
  }
}
