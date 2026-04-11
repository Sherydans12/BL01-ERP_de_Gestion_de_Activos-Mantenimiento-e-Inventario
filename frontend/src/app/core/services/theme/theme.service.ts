import { Injectable, inject, effect, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TenantService } from '../tenant/tenant.service';

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`
    : '0 229 255';
}

const THEME_STORAGE_KEY = 'tpm-theme';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private tenantService = inject(TenantService);
  private platformId = inject(PLATFORM_ID);

  isDark = signal(true);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored) {
          this.isDark.set(stored === 'dark');
        }
      } catch {
        /* ignore */
      }
    }

    effect(() => {
      const tenant = this.tenantService.currentTenant();
      if (!isPlatformBrowser(this.platformId)) return;

      document.documentElement.style.setProperty(
        '--primary-rgb',
        tenant?.primaryColor ? hexToRgb(tenant.primaryColor) : '0 229 255',
      );

      /* backgroundPreference is no longer used — theme is a per-user preference
         managed via the toggle in the topbar and persisted in localStorage. */
    });
  }

  toggleTheme() {
    this.isDark.update((v) => !v);
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, this.isDark() ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }
}
