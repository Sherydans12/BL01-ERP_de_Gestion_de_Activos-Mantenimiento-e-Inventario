import { Injectable, signal } from '@angular/core';

export type QuickViewKind = 'REQ' | 'PO' | 'INV' | 'WR' | 'EQUIP';

@Injectable({
  providedIn: 'root',
})
export class QuickViewService {
  /** Documento activo en vista rápida (un solo modal a la vez). */
  readonly state = signal<{ kind: QuickViewKind; id: string } | null>(null);

  open(kind: QuickViewKind, id: string): void {
    if (!id?.trim()) return;
    this.state.set({ kind, id: id.trim() });
  }

  close(): void {
    this.state.set(null);
  }
}
