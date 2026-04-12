import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { EMPTY, from, Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

const APPROVER_ROLES = ['ADMIN', 'SUPER_ADMIN', 'SUPERVISOR'] as const;
const SESSION_ATTEMPT_KEY = 'bl_push_subscribe_attempted';

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
        const orderId = this.extractOrderIdFromPayload(event.notification.data);
        if (orderId) {
          void this.router
            .navigate(['/app/compras/ordenes', orderId])
            .then(() => this.dismissBrowserNotifications());
        } else {
          void this.dismissBrowserNotifications();
        }
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

  /** Angular expone `notification` como NotificationOptions + title, no como Notification DOM. */
  private extractOrderIdFromPayload(data: unknown): string | null {
    if (data == null) return null;
    if (typeof data === 'object' && data !== null && 'orderId' in data) {
      const v = (data as Record<string, unknown>)['orderId'];
      return typeof v === 'string' ? v : null;
    }
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const id = parsed['orderId'];
        return typeof id === 'string' ? id : null;
      } catch {
        return null;
      }
    }
    return null;
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
