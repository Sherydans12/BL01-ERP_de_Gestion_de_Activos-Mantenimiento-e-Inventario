import { ApplicationRef, Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SwUpdate } from '@angular/service-worker';
import {
  filter,
  merge,
  interval,
  fromEvent,
  startWith,
  take,
  switchMap,
} from 'rxjs';

/**
 * Tras un redeploy, el Angular Service Worker puede tener una nueva `ngsw.json`
 * sin que el cliente activo la aplique. Aquí forzamos comprobaciones y recarga
 * cuando el worker ya descargó la nueva versión.
 */
@Injectable({ providedIn: 'root' })
export class AppDeploySyncService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly swUpdate = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);

  constructor() {
    if (!isPlatformBrowser(this.platformId) || !this.swUpdate.isEnabled) {
      return;
    }

    this.swUpdate.versionUpdates
      .pipe(filter((e) => e.type === 'VERSION_READY'))
      .subscribe(() => {
        void this.swUpdate.activateUpdate().then(() => globalThis.location.reload());
      });

    this.swUpdate.unrecoverable.subscribe(() => {
      globalThis.location.reload();
    });

    this.appRef.isStable
      .pipe(
        filter(Boolean),
        take(1),
        switchMap(() =>
          merge(
            interval(5 * 60 * 1000).pipe(startWith(0)),
            fromEvent(globalThis, 'focus'),
          ),
        ),
      )
      .subscribe(() => {
        void this.swUpdate.checkForUpdate();
      });
  }
}
