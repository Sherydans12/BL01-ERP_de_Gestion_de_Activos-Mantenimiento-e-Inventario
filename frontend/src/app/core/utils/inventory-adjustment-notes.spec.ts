import { parseInventoryAdjustmentNotes } from './inventory-adjustment-notes';

describe('parseInventoryAdjustmentNotes', () => {
  it('normaliza notas antiguas de Error de conteo al label vigente', () => {
    const out = parseInventoryAdjustmentNotes(
      'Ajuste [Error de conteo]: diferencia detectada en conteo cíclico',
    );

    expect(out.reason).toBe('Ajuste por inventario (conteo / hallazgo)');
    expect(out.comment).toBe('diferencia detectada en conteo cíclico');
  });

  it('reconoce Entrega de EPP', () => {
    const out = parseInventoryAdjustmentNotes(
      'Ajuste [Entrega de EPP]: entrega a operador turno A',
    );

    expect(out.reason).toBe('Entrega de EPP');
    expect(out.comment).toBe('entrega a operador turno A');
  });
});

