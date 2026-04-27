import PDFDocument from 'pdfkit';

/** Datos mínimos del tablero para el PDF (evita import circular con el servicio). */
export type WorkOrderAnalyticsDashboardPdfSlice = {
  kpis: {
    fleetAvailabilityPct: number | null;
    mttrHours: number | null;
    mtbfHours: number | null;
    downtimeImpactHoursSi: number;
    correctiveOtCountForMttr: number;
    unplannedFailureIntervalsForMtbf: number;
  };
  paretoSystems: Array<{ label: string; otCount: number }>;
  programmedSplit: {
    programmed: number;
    notProgrammed: number;
    unknown: number;
  };
};

export type WorkOrderManagementMonthlyPdfInput = {
  tenantName: string;
  year: number;
  month: number;
  contractLabel: string;
  dashboard: WorkOrderAnalyticsDashboardPdfSlice;
  /** Referencia por equipo (peor PA primero); etiquetas sin marca/modelo usan patente / N° interno. */
  availabilityReferenceLines?: Array<{
    label: string;
    availabilityPct: string;
  }>;
  totalAssetCostWo: number;
  totalLaborHours: number;
  laborRatePerHour: number;
  laborCostEstimate: number;
  totalMaintenanceEstimate: number;
};

function formatClp(n: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)} %`;
}

function formatHours(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)} h`;
}

/**
 * PDF ejecutivo: Resumen de Gestión Mensual (confiabilidad + costos de mantenimiento).
 */
export function generateWorkOrderManagementMonthlyPdfBuffer(
  payload: WorkOrderManagementMonthlyPdfInput,
): Promise<Buffer> {
  const {
    tenantName,
    year,
    month,
    contractLabel,
    dashboard,
    availabilityReferenceLines,
    totalAssetCostWo,
    totalLaborHours,
    laborRatePerHour,
    laborCostEstimate,
    totalMaintenanceEstimate,
  } = payload;

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc
      .fontSize(16)
      .fillColor('#1a1a1a')
      .text(tenantName, left, doc.y, { width });
    doc.moveDown(0.3);

    doc
      .fontSize(18)
      .fillColor('#111111')
      .text('Resumen de Gestión Mensual — Mantenimiento', { align: 'center' });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor('#555555')
      .text(`Período: ${monthLabel}`, { align: 'center' });
    doc.fontSize(10).text(`Alcance: ${contractLabel}`, { align: 'center' });
    doc.moveDown(1.2);

    doc.fontSize(12).fillColor('#000000').text('Indicadores de confiabilidad', {
      underline: true,
    });
    doc.moveDown(0.6);

    const kpiH = 52;
    const gap = 10;
    const colW = (width - gap * 2) / 3;
    const boxY = doc.y;

    const drawKpi = (x: number, title: string, value: string) => {
      doc.save();
      doc.roundedRect(x, boxY, colW, kpiH, 4).stroke('#cccccc');
      doc
        .fontSize(8)
        .fillColor('#666666')
        .text(title, x + 8, boxY + 8, { width: colW - 16 });
      doc
        .fontSize(11)
        .fillColor('#111111')
        .text(value, x + 8, boxY + 26, {
          width: colW - 16,
        });
      doc.restore();
    };

    const k = dashboard.kpis;
    drawKpi(
      left,
      'Disponibilidad física (flota)',
      formatPct(k.fleetAvailabilityPct),
    );
    drawKpi(left + colW + gap, 'MTTR (correctivas)', formatHours(k.mttrHours));
    drawKpi(
      left + (colW + gap) * 2,
      'MTBF (entre fallas no programadas)',
      formatHours(k.mtbfHours),
    );
    doc.y = boxY + kpiH + 16;

    doc
      .fontSize(9)
      .fillColor('#444444')
      .text(
        `Horas de detención con impacto en disponibilidad (recorte al mes): ${k.downtimeImpactHoursSi.toFixed(1)} h · OT correctivas en MTTR: ${k.correctiveOtCountForMttr} · Intervalos MTBF: ${k.unplannedFailureIntervalsForMtbf}`,
        left,
        doc.y,
        { width },
      );
    doc.moveDown(1.2);

    const refLines = availabilityReferenceLines ?? [];
    if (refLines.length > 0) {
      doc
        .fontSize(12)
        .fillColor('#000000')
        .text('Referencia — disponibilidad por equipo (menor PA primero)', {
          underline: true,
        });
      doc.moveDown(0.5);
      doc
        .fontSize(8)
        .fillColor('#888888')
        .text(
          'Etiqueta: marca/modelo si existe; si no, patente o N° interno.',
          left,
          doc.y,
          { width },
        );
      doc.moveDown(0.4);
      doc.fontSize(9).fillColor('#444444');
      for (const row of refLines) {
        doc.text(`• ${row.label}: ${row.availabilityPct}`, { width });
      }
      doc.moveDown(1);
    }

    doc
      .fontSize(12)
      .fillColor('#000000')
      .text('Costos de mantenimiento (estimado)', {
        underline: true,
      });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#333333');
    doc.text(
      `Repuestos y fluidos (asset cost WORK_ORDER): ${formatClp(totalAssetCostWo)}`,
      {
        width,
      },
    );
    doc.text(
      `Mano de obra: ${totalLaborHours.toFixed(1)} HH × ${formatClp(laborRatePerHour)} = ${formatClp(laborCostEstimate)}`,
      { width },
    );
    doc.moveDown(0.3);
    doc
      .fontSize(11)
      .fillColor('#111111')
      .text(`Total estimado: ${formatClp(totalMaintenanceEstimate)}`, {
        width,
      });
    doc.moveDown(1);

    doc
      .fontSize(12)
      .fillColor('#000000')
      .text('Programado vs no programado (OT cerradas)', {
        underline: true,
      });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#333333');
    const ps = dashboard.programmedSplit;
    doc.text(`Programadas: ${ps.programmed}`, { width });
    doc.text(`No programadas: ${ps.notProgrammed}`, { width });
    doc.text(`Sin clasificar / otras: ${ps.unknown}`, { width });
    doc.moveDown(0.8);

    doc
      .fontSize(12)
      .fillColor('#000000')
      .text('Pareto — sistemas intervenidos (conteo OT)', {
        underline: true,
      });
    doc.moveDown(0.5);
    const topPareto = [...dashboard.paretoSystems]
      .filter((p) => p.otCount > 0)
      .slice(0, 8);
    doc.fontSize(9).fillColor('#444444');
    if (topPareto.length === 0) {
      doc.text('Sin intervenciones registradas en el período.', { width });
    } else {
      for (const row of topPareto) {
        doc.text(`• ${row.label}: ${row.otCount}`, { width });
      }
    }

    doc.end();
  });
}
