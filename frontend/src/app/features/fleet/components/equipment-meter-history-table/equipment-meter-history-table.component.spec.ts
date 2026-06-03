/**
 * Suite de pruebas del componente de tabla de historial de horómetro.
 *
 * Foco: verificar que la tabla renderiza correctamente las filas ya procesadas
 * (deltaFromPrevious, sourceLabel, reading) que le llegan como input() del modal.
 *
 * Este componente es puramente presentacional: recibe EquipmentMeterHistoryRow[]
 * y los muestra. La lógica de transformación (delta, traducción de fuente) es
 * responsabilidad de EquipmentDetailModalComponent (cubierta en su propio spec).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  EquipmentMeterHistoryTableComponent,
  EquipmentMeterHistoryRow,
} from './equipment-meter-history-table.component';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: payload del escenario "Caos en Terreno" ya transformado
// (orden ASC, como lo entrega meterHistoryRows del modal)
// ─────────────────────────────────────────────────────────────────────────────

const ROW_AVAIL: EquipmentMeterHistoryRow = {
  id:                'log-avail',
  date:              '2026-06-03T08:00:00Z',
  reading:           5050,
  deltaFromPrevious: 50,
  sourceLabel:       'Reporte de disponibilidad',
  userLabel:         'María López',
};

const ROW_FAULT: EquipmentMeterHistoryRow = {
  id:                'log-fault',
  date:              '2026-06-03T12:00:00Z',
  reading:           5100,
  deltaFromPrevious: 50,
  sourceLabel:       'Reporte de falla',
  userLabel:         'Juan Pérez',
};

const CHAOS_ROWS: EquipmentMeterHistoryRow[] = [ROW_AVAIL, ROW_FAULT];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve el texto limpio del TD de delta (3.ª columna, 0-indexed). */
function getDeltaCell(row: Element): HTMLTableCellElement {
  return row.querySelectorAll('td')[2] as HTMLTableCellElement;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('EquipmentMeterHistoryTableComponent — renderizado DOM', () => {
  let component: EquipmentMeterHistoryTableComponent;
  let fixture: ComponentFixture<EquipmentMeterHistoryTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EquipmentMeterHistoryTableComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EquipmentMeterHistoryTableComponent);
    component = fixture.componentInstance;
  });

  // ── Estado vacío ──────────────────────────────────────────────────────────

  it('debería crearse sin errores', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('muestra el mensaje "Sin registros de medidor" cuando rows está vacío', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Sin registros de medidor');
  });

  it('no renderiza la tabla cuando rows está vacío', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
  });

  // ── Cardinalidad de filas ─────────────────────────────────────────────────

  it('renderiza exactamente 2 filas de datos para el escenario del caos en terreno', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('renderiza exactamente 1 fila cuando se pasa un único registro', () => {
    fixture.componentRef.setInput('rows', [ROW_AVAIL]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
  });

  // ── Contenido de la primera fila (AVAILABILITY_REPORT, la más antigua) ────

  it('primera fila (AVAILABILITY_REPORT): muestra el delta "+50 Hrs"', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.componentRef.setInput('meterUnit', 'Hrs');
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    const firstRowText: string = rows[0].textContent ?? '';
    expect(firstRowText).toContain('+50');
    expect(firstRowText).toContain('Hrs');
  });

  it('primera fila: muestra la etiqueta "Reporte de disponibilidad"', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect((rows[0] as HTMLElement).textContent).toContain(
      'Reporte de disponibilidad',
    );
  });

  it('primera fila: muestra el nombre de usuario "María López"', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect((rows[0] as HTMLElement).textContent).toContain('María López');
  });

  // ── Contenido de la segunda fila (FAULT_REPORT, la más reciente) ─────────

  it('segunda fila (FAULT_REPORT, la más reciente): muestra el delta "+50 Hrs"', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.componentRef.setInput('meterUnit', 'Hrs');
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    const secondRowText: string = rows[1].textContent ?? '';
    expect(secondRowText).toContain('+50');
    expect(secondRowText).toContain('Hrs');
  });

  it('segunda fila: muestra la etiqueta "Reporte de falla"', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect((rows[1] as HTMLElement).textContent).toContain('Reporte de falla');
  });

  it('segunda fila: muestra el nombre de usuario "Juan Pérez"', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect((rows[1] as HTMLElement).textContent).toContain('Juan Pérez');
  });

  // ── Clases CSS del delta ─────────────────────────────────────────────────

  it('aplica clase text-success al delta positivo (+50)', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(getDeltaCell(rows[0]).classList).toContain('text-success');
    expect(getDeltaCell(rows[1]).classList).toContain('text-success');
  });

  it('aplica clase text-success al delta cero (sin retroceso)', () => {
    const rowZeroDelta: EquipmentMeterHistoryRow = {
      ...ROW_AVAIL,
      deltaFromPrevious: 0,
    };
    fixture.componentRef.setInput('rows', [rowZeroDelta]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(getDeltaCell(rows[0]).classList).toContain('text-success');
  });

  it('aplica clase text-warning al delta negativo (horómetro regresivo detectado)', () => {
    const rowNegative: EquipmentMeterHistoryRow = {
      ...ROW_AVAIL,
      deltaFromPrevious: -100,
    };
    fixture.componentRef.setInput('rows', [rowNegative]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(getDeltaCell(rows[0]).classList).toContain('text-warning');
  });

  it('NO aplica text-success ni text-warning cuando deltaFromPrevious es null', () => {
    const rowNoDelta: EquipmentMeterHistoryRow = {
      ...ROW_AVAIL,
      deltaFromPrevious: null,
    };
    fixture.componentRef.setInput('rows', [rowNoDelta]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    const cell = getDeltaCell(rows[0]);
    expect(cell.classList).not.toContain('text-success');
    expect(cell.classList).not.toContain('text-warning');
  });

  // ── Símbolo "—" para delta null ───────────────────────────────────────────

  it('muestra "—" en la celda de delta cuando deltaFromPrevious es null (primer registro)', () => {
    const rowNoDelta: EquipmentMeterHistoryRow = {
      ...ROW_AVAIL,
      deltaFromPrevious: null,
    };
    fixture.componentRef.setInput('rows', [rowNoDelta]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(getDeltaCell(rows[0]).textContent?.trim()).toBe('—');
  });

  // ── Prefijo "+" / signo negativo ──────────────────────────────────────────

  it('delta positivo lleva prefijo "+" en el texto renderizado', () => {
    fixture.componentRef.setInput('rows', [ROW_FAULT]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(getDeltaCell(rows[0]).textContent).toContain('+');
  });

  it('delta negativo NO lleva prefijo "+" (solo el guión del número negativo)', () => {
    const rowNeg: EquipmentMeterHistoryRow = { ...ROW_AVAIL, deltaFromPrevious: -50 };
    fixture.componentRef.setInput('rows', [rowNeg]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    const cellText: string = getDeltaCell(rows[0]).textContent ?? '';
    // El template solo agrega "+" para >= 0; para negativo el número ya lleva su signo
    expect(cellText).not.toContain('++');
    expect(cellText).toContain('-');
  });

  // ── Input meterUnit ───────────────────────────────────────────────────────

  it('respeta meterUnit="Km" cuando el equipo usa odómetro', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.componentRef.setInput('meterUnit', 'Km');
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Km');
  });

  it('usa "Hrs" como meterUnit por defecto', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    // No se setea meterUnit → debe usar el default del input()
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Hrs');
  });

  // ── Cabeceras de la tabla ─────────────────────────────────────────────────

  it('renderiza las 5 cabeceras de columna esperadas', () => {
    fixture.componentRef.setInput('rows', CHAOS_ROWS);
    fixture.detectChanges();
    const headers = fixture.nativeElement.querySelectorAll('thead th');
    expect(headers.length).toBe(5);
    const texts = Array.from(headers).map((h: any) => h.textContent?.trim());
    expect(texts).toContain('Fecha');
    expect(texts).toContain('Valor');
    expect(texts).toContain('Fuente');
    expect(texts).toContain('Usuario');
  });

  // ── formatNum ─────────────────────────────────────────────────────────────

  it('formatNum formatea un número entero pequeño sin separadores', () => {
    // 50 no tiene miles, debe devolver '50'
    expect(component.formatNum(50)).toBe('50');
  });
});
