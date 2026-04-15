import { Component, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { QuickViewService, QuickViewKind } from '../quick-view/quick-view.service';

@Component({
  selector: 'app-entity-link',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './entity-link.component.html',
})
export class EntityLinkComponent {
  private qv = inject(QuickViewService);
  private router = inject(Router);

  kind = input.required<QuickViewKind>();
  id = input.required<string>();
  /** Correlativo u otra etiqueta legible. */
  label = input.required<string>();
  variant = input<'link' | 'badge'>('link');
  /** Para INV: navegar a la OC con pestaña facturación (detalle completo). */
  purchaseOrderIdForDetail = input<string | null>(null);

  readonly tooltip = 'Hacer clic para vista rápida';

  onPrimaryClick(ev: MouseEvent): void {
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      this.openFullDetail();
      return;
    }
    ev.preventDefault();
    this.qv.open(this.kind(), this.id());
  }

  openFullDetail(ev?: MouseEvent): void {
    ev?.preventDefault();
    ev?.stopPropagation();
    const k = this.kind();
    const entityId = this.id();
    if (k === 'REQ') {
      const url = this.router.serializeUrl(
        this.router.createUrlTree(['/app/compras/requerimientos', entityId]),
      );
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (k === 'PO') {
      const url = this.router.serializeUrl(
        this.router.createUrlTree(['/app/compras/ordenes', entityId]),
      );
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (k === 'WR') {
      const url = this.router.serializeUrl(
        this.router.createUrlTree(['/app/compras/recepciones', entityId]),
      );
      window.open(url, '_blank', 'noopener');
      return;
    }
    const po = this.purchaseOrderIdForDetail();
    if (po) {
      const url = this.router.serializeUrl(
        this.router.createUrlTree(['/app/compras/ordenes', po], {
          queryParams: { tab: 'billing' },
        }),
      );
      window.open(url, '_blank', 'noopener');
    } else {
      const url = this.router.serializeUrl(
        this.router.createUrlTree(['/app/compras/facturas']),
      );
      window.open(url, '_blank', 'noopener');
    }
  }
}
