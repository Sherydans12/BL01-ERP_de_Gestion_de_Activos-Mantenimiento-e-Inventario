import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, throwError, tap } from 'rxjs';
import { EquipmentMeterSnapshot } from '../../models/types';
import { FleetService } from '../fleet/fleet.service';

/**
 * Snapshot de medidor para OT / widgets. Caché en memoria: si falla la red,
 * se devuelve el último valor conocido por equipo (misma sesión de app).
 */
@Injectable({
  providedIn: 'root',
})
export class EquipmentMeterSnapshotService {
  private fleet = inject(FleetService);
  private cache = new Map<string, EquipmentMeterSnapshot>();

  getSnapshot(equipmentId: string): Observable<EquipmentMeterSnapshot> {
    return this.fleet.getEquipmentMeterSnapshot(equipmentId).pipe(
      tap((s) => this.cache.set(equipmentId, s)),
      catchError((err) => {
        const hit = this.cache.get(equipmentId);
        if (hit) {
          return of(hit);
        }
        return throwError(() => err);
      }),
    );
  }

  peekCached(equipmentId: string): EquipmentMeterSnapshot | undefined {
    return this.cache.get(equipmentId);
  }
}
