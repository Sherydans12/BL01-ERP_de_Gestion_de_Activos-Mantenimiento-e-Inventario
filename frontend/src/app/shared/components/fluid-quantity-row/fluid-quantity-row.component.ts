import {
  Component,
  computed,
  effect,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  exceedsAvailableStock,
  hasInvalidDecimalQuantity,
  largeFluidDispatchThreshold,
  parseFluidQuantity,
  requiresLargeDispatchConfirmation,
} from '../../utils/fluid-dispatch-limits.util';

export interface FluidQuantityValidation {
  valid: boolean;
  blocking: boolean;
  formatError: boolean;
  exceedsStock: boolean;
  needsLargeConfirm: boolean;
}

@Component({
  selector: 'app-fluid-quantity-row',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './fluid-quantity-row.component.html',
  styleUrl: './fluid-quantity-row.component.scss',
})
export class FluidQuantityRowComponent {
  itemId = input.required<string>();
  unitAbbr = input.required<string>();
  allowsDecimals = input(false);
  availableStock = input<number | null>(null);
  blockNegativeStock = input(false);
  quantityControl = input.required<FormControl<string | number | null>>();

  confirmedLargeDispatch = input(false);
  confirmedLargeDispatchChange = output<boolean>();
  validationChange = output<FluidQuantityValidation>();

  quantity = computed(() =>
    parseFluidQuantity(this.quantityControl().value, this.allowsDecimals()),
  );

  formatError = computed(() =>
    hasInvalidDecimalQuantity(this.quantity(), this.allowsDecimals()),
  );

  exceedsStock = computed(() => {
    const avail = this.availableStock();
    if (avail == null) return false;
    return exceedsAvailableStock(avail, this.quantity());
  });

  isBlocking = computed(() => this.blockNegativeStock() && this.exceedsStock());

  needsLargeConfirm = computed(() =>
    requiresLargeDispatchConfirmation(
      this.quantity(),
      this.unitAbbr(),
      this.allowsDecimals(),
    ),
  );

  largeThreshold = computed(() =>
    largeFluidDispatchThreshold(this.unitAbbr(), this.allowsDecimals()),
  );

  isValid = computed(() => {
    const q = this.quantity();
    if (q <= 0) return false;
    if (this.formatError()) return false;
    if (this.isBlocking()) return false;
    if (this.needsLargeConfirm() && !this.confirmedLargeDispatch()) return false;
    return true;
  });

  constructor() {
    effect(() => {
      this.quantity();
      this.confirmedLargeDispatch();
      this.blockNegativeStock();
      this.availableStock();
      this.emitValidation();
    });
  }

  onLargeConfirm(ev: Event): void {
    this.confirmedLargeDispatchChange.emit(
      (ev.target as HTMLInputElement).checked,
    );
  }

  onBlurNormalize(): void {
    const q = this.quantity();
    if (q <= 0) return;
    const normalized = this.allowsDecimals()
      ? String(Number(q.toFixed(3)))
      : String(Math.floor(q));
    this.quantityControl().setValue(normalized, { emitEvent: true });
  }

  private emitValidation(): void {
    this.validationChange.emit({
      valid: this.isValid(),
      blocking: this.isBlocking(),
      formatError: this.formatError(),
      exceedsStock: this.exceedsStock(),
      needsLargeConfirm: this.needsLargeConfirm(),
    });
  }
}
