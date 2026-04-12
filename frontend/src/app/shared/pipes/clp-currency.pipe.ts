import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'clpCurrency', standalone: true })
export class ClpCurrencyPipe implements PipeTransform {
  transform(value: number | string | null | undefined, currency = 'CLP'): string {
    if (value == null) return '—';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '—';
    const formatted = num.toLocaleString('es-CL', { maximumFractionDigits: 0 });
    return `${currency} ${formatted}`;
  }
}
