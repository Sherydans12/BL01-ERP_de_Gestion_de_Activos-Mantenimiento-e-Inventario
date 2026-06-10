import { test as base } from '@playwright/test';
import { API_BASE } from '../helpers/auth';

export const test = base.extend({
  backendAvailable: async ({}, use) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 4000 * attempt));
      }
      const ping = await fetch(`${API_BASE}/auth/captcha`).catch(() => null);
      if (ping?.ok) {
        await use(true);
        return;
      }
    }
    test.skip(true, 'Backend no disponible o throttle auth (429) en :3000');
  },
});

export { expect } from '@playwright/test';
