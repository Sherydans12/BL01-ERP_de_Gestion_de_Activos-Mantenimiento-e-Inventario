import { Component, computed, inject } from '@angular/core';
import { EquipmentDetailModalComponent } from '../../../features/fleet/equipment-detail-modal/equipment-detail-modal.component';
import { QuickViewService } from './quick-view.service';

@Component({
  selector: 'app-equipment-quick-view',
  standalone: true,
  imports: [EquipmentDetailModalComponent],
  template: `
    <app-equipment-detail-modal
      [equipmentId]="equipmentId()"
      [isOpen]="isOpen()"
      (close)="close()"
    />
  `,
})
export class EquipmentQuickViewComponent {
  private qv = inject(QuickViewService);

  isOpen = computed(() => this.qv.state()?.kind === 'EQUIP');
  equipmentId = computed(() =>
    this.qv.state()?.kind === 'EQUIP' ? this.qv.state()?.id ?? null : null,
  );

  close(): void {
    this.qv.close();
  }
}
