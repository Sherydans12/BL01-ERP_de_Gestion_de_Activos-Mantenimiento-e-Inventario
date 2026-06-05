import { sanitizeExcelWorksheetName } from './excel-worksheet-name.util';

describe('sanitizeExcelWorksheetName', () => {
  it('reemplaza dos puntos de hora (08:00) por guión', () => {
    expect(sanitizeExcelWorksheetName('Disponibilidad Día (08:00)')).toBe(
      'Disponibilidad Día (08-00)',
    );
  });

  it('elimina caracteres prohibidos y recorta a 31 caracteres', () => {
    const long = 'A'.repeat(40);
    expect(sanitizeExcelWorksheetName(long)).toHaveLength(31);
    expect(sanitizeExcelWorksheetName('a/b?c*d[e]f:g')).toBe('a-b-c-d-e-f-g');
  });

  it('devuelve Sheet1 si el nombre queda vacío tras limpiar', () => {
    expect(sanitizeExcelWorksheetName('::::')).toBe('Sheet1');
  });
});
