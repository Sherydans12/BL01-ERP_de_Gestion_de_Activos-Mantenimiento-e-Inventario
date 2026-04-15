import { Component } from '@angular/core';
import { PurchaseRequisitionQuickViewComponent } from './purchase-requisition-quick-view.component';
import { PurchaseOrderQuickViewComponent } from './purchase-order-quick-view.component';
import { PurchaseInvoiceQuickViewComponent } from './purchase-invoice-quick-view.component';
import { WarehouseReceiptQuickViewComponent } from './warehouse-receipt-quick-view.component';
import { EquipmentQuickViewComponent } from './equipment-quick-view.component';

@Component({
  selector: 'app-quick-view-host',
  standalone: true,
  imports: [
    PurchaseRequisitionQuickViewComponent,
    PurchaseOrderQuickViewComponent,
    PurchaseInvoiceQuickViewComponent,
    WarehouseReceiptQuickViewComponent,
    EquipmentQuickViewComponent,
  ],
  template: `
    <app-purchase-requisition-quick-view />
    <app-purchase-order-quick-view />
    <app-purchase-invoice-quick-view />
    <app-warehouse-receipt-quick-view />
    <app-equipment-quick-view />
  `,
})
export class QuickViewHostComponent {}
