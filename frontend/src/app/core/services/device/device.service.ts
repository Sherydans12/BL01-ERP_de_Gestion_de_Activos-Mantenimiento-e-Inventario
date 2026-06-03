import { Injectable, signal } from '@angular/core';

/** Breakpoint Tailwind `md` = 768px. Debajo → mobile. */
const MOBILE_BREAKPOINT = '(max-width: 767px)';

@Injectable({ providedIn: 'root' })
export class DeviceService {
  readonly isMobile = signal(
    typeof window !== 'undefined'
      ? window.matchMedia(MOBILE_BREAKPOINT).matches
      : false,
  );

  constructor() {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    mq.addEventListener('change', (e) => this.isMobile.set(e.matches));
  }
}
