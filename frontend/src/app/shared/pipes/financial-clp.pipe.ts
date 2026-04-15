import { Pipe, PipeTransform, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth/auth.service';
import { formatClpValue } from './clp-currency.pipe';

const MASK = '$ ****';

/**
 * Muestra montos en CLP solo si el rol puede ver información financiera de compras;
 * en caso contrario enmascara (p. ej. mecánicos / operación).
 */
@Pipe({
  name: 'financialClp',
  standalone: true,
})
export class FinancialClpPipe implements PipeTransform {
  private auth = inject(AuthService);

  transform(
    value: number | string | null | undefined,
    currency = 'CLP',
  ): string {
    if (!this.auth.canSeePurchaseFinancials()) {
      return MASK;
    }
    return formatClpValue(value, currency);
  }
}
