import { Injectable, inject, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TenantService } from '../tenant/tenant.service';

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`
    : '0 229 255';
}

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private tenantService = inject(TenantService);
  private platformId = inject(PLATFORM_ID);

  constructor() {
    effect(() => {
      const tenant = this.tenantService.currentTenant();

      if (isPlatformBrowser(this.platformId)) {
        if (tenant?.primaryColor) {
          document.documentElement.style.setProperty(
            '--primary-rgb',
            hexToRgb(tenant.primaryColor),
          );
        } else {
          document.documentElement.style.setProperty(
            '--primary-rgb',
            '0 229 255',
          );
        }

        if (tenant?.backgroundPreference === 'LIGHT') {
          document.documentElement.setAttribute('data-theme', 'light');
        } else {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
      }
    });
  }
}
