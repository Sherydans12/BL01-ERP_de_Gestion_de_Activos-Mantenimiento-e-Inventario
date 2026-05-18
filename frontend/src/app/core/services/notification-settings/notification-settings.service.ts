import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import type {
  TenantNotificationSetting,
  UserNotificationSetting,
  UserNotificationSettingWithUser,
  UpsertTenantNotificationSettingPayload,
  UpsertUserNotificationSettingPayload,
} from '../../models/notification-settings.interface';

@Injectable({ providedIn: 'root' })
export class NotificationSettingsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/notification-settings`;

  // ── Tenant-level ──────────────────────────────────────────────────────────

  getTenantSettings() {
    return this.http.get<TenantNotificationSetting[]>(`${this.base}/tenant`);
  }

  upsertTenantSetting(payload: UpsertTenantNotificationSettingPayload) {
    return this.http.put<TenantNotificationSetting>(
      `${this.base}/tenant`,
      payload,
    );
  }

  // ── User-level ────────────────────────────────────────────────────────────

  getUserSettings(userId?: string) {
    return this.http.get<UserNotificationSetting[]>(`${this.base}/user`, {
      params: userId ? { userId } : undefined,
    });
  }

  upsertUserSetting(payload: UpsertUserNotificationSettingPayload) {
    return this.http.put<UserNotificationSetting>(
      `${this.base}/user`,
      payload,
    );
  }

  /** Suscripciones enriquecidas con datos de usuario para un evento (panel gobernanza). */
  getEventSubscribers(eventKey: string) {
    return this.http.get<UserNotificationSettingWithUser[]>(
      `${this.base}/event`,
      { params: { eventKey } },
    );
  }
}
