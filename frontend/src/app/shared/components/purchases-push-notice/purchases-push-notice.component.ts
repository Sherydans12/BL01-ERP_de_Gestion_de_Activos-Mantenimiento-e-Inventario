import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PushNotificationsService } from '../../../core/services/push-notifications/push-notifications.service';

/**
 * Aviso ámbar cuando el navegador bloqueó notificaciones push (mismo criterio que configuración de compras).
 */
@Component({
  selector: 'app-purchases-push-notice',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (blocked()) {
      <div
        class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-main"
        role="status"
      >
        Las notificaciones están bloqueadas en este navegador. Actívelas en la configuración del sitio
        para recibir alertas de firma y estado de órdenes de compra.
      </div>
    }
  `,
})
export class PurchasesPushNoticeComponent implements OnInit {
  blocked = signal(false);

  ngOnInit(): void {
    this.blocked.set(PushNotificationsService.notificationsDenied());
  }
}
