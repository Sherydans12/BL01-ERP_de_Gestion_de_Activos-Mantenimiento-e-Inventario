import PDFDocument from 'pdfkit';

/** Subconjunto del resultado de `PurchasesAnalyticsService.getDashboard`. */
export type PurchasesAnalyticsDashboardPdfData = {
  filters: { from: string; to: string; contractId: string | null };
  kpis: {
    totalApprovedSpend: number;
    pendingSignaturePurchaseOrders: number;
    invoiceDiscrepancyRate: number;
    invoiceDiscrepancyCount: number;
    invoiceTotalForRate: number;
    /** Σ (max P.U. cotizado − adjudicado) × cantidad en SRC del período. */
    multiproviderAdjudicationSavings?: number;
  };
  requisitionPipeline?: Record<string, number>;
  partialRequisitionPurchaseProgress?: {
    partialRequisitionCount: number;
    lineItemsTotal: number;
    lineItemsWithActivePo: number;
  };
  requisitionPurchaseRows?: Array<{
    correlative: string;
    status: string;
    ocLines: string[];
  }>;
  imputationSpend: { general: number; equipment: number; workOrder: number };
  monthlySpend: Array<{ month: string; total: number }>;
  topVendors: Array<{
    vendorId: string;
    vendorName: string;
    vendorCode: string;
    purchaseVolume: number;
    avgLeadTimeDays: number | null;
  }>;
  overpaymentPrevention: number;
};

function formatClp(n: number): string {
  try {
    return `$ ${n.toLocaleString('es-CL', { maximumFractionDigits: 0 })}`;
  } catch {
    return `$ ${n}`;
  }
}

function formatPct(n: number): string {
  return `${(n * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 })} %`;
}

/** Lead time medio ponderado por volumen de compra (top proveedores). */
export function weightedAvgLeadTimeDays(
  vendors: PurchasesAnalyticsDashboardPdfData['topVendors'],
): number | null {
  let num = 0;
  let den = 0;
  for (const v of vendors) {
    if (v.avgLeadTimeDays != null && v.purchaseVolume > 0) {
      num += v.avgLeadTimeDays * v.purchaseVolume;
      den += v.purchaseVolume;
    }
  }
  if (den <= 0) return null;
  return Math.round((num / den) * 10) / 10;
}

function barAscii(pct: number, width = 24): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${p.toFixed(0)}%`;
}

/**
 * PDF ejecutivo de compras (tablas + barras ASCII; sin JS en cliente).
 */
export function generatePurchasesAnalyticsReportPdfBuffer(
  tenantName: string,
  logoBuffer: Buffer | null,
  contractLabel: string,
  periodFrom: Date,
  periodTo: Date,
  data: PurchasesAnalyticsDashboardPdfData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const leadAvg = weightedAvgLeadTimeDays(data.topVendors);

    if (logoBuffer) {
      try {
        const imgW = Math.min(100, width * 0.35);
        const logoTop = doc.y;
        doc.image(logoBuffer, left, logoTop, { width: imgW });
        doc.y = logoTop + 52;
      } catch {
        /* omitir logo si formato no soportado */
      }
    }

    doc
      .fontSize(16)
      .fillColor('#1a1a1a')
      .text(tenantName, left, doc.y, { width });
    doc.moveDown(0.3);

    doc
      .fontSize(18)
      .fillColor('#111111')
      .text('Reporte Ejecutivo de Gestión de Compras', { align: 'center' });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor('#555555')
      .text(
        `Período: ${periodFrom.toLocaleDateString('es-CL', { timeZone: 'UTC' })} — ${periodTo.toLocaleDateString('es-CL', { timeZone: 'UTC' })}`,
        { align: 'center' },
      );
    doc.fontSize(10).text(`Alcance: ${contractLabel}`, { align: 'center' });
    doc.moveDown(1.2);

    doc.fontSize(12).fillColor('#000000').text('Resumen ejecutivo', {
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

    drawKpi(
      left,
      'Gasto total aprobado (OC)',
      formatClp(data.kpis.totalApprovedSpend),
    );
    drawKpi(
      left + colW + gap,
      'Prevención de sobrepagos',
      formatClp(data.overpaymentPrevention),
    );
    drawKpi(
      left + (colW + gap) * 2,
      'Lead time promedio (ponderado)',
      leadAvg != null ? `${leadAvg} días` : '—',
    );
    doc.y = boxY + kpiH + 16;

    const mpSave = data.kpis.multiproviderAdjudicationSavings ?? 0;
    doc
      .fontSize(10)
      .fillColor('#0f766e')
      .text(
        `Ahorro por adjudicación multiproveedor (SRC actualizados en el período): ${formatClp(mpSave)}`,
        left,
        doc.y,
        { width },
      );
    doc.moveDown(0.4);
    doc
      .fontSize(8)
      .fillColor('#666666')
      .text(
        'Estimación: por cada ítem adjudicado se compara el precio unitario máximo cotizado frente al adjudicado, multiplicado por la cantidad solicitada.',
        left,
        doc.y,
        { width },
      );
    doc.moveDown(0.8);

    const part = data.partialRequisitionPurchaseProgress;
    if (part && part.lineItemsTotal > 0) {
      doc
        .fontSize(10)
        .fillColor('#0c4a6e')
        .text(
          `Compras parciales: ${part.lineItemsWithActivePo} / ${part.lineItemsTotal} líneas de ítem con OC activa ` +
            `(${part.partialRequisitionCount} SRC en estado compra parcial).`,
          left,
          doc.y,
          { width },
        );
      doc.moveDown(0.6);
    }

    const rowsReq = data.requisitionPurchaseRows ?? [];
    if (rowsReq.length > 0) {
      doc.fontSize(11).fillColor('#111111').text('Requerimientos — OC y proveedor', {
        underline: true,
      });
      doc.moveDown(0.4);
      doc.fontSize(8).fillColor('#333333');
      for (const r of rowsReq.slice(0, 28)) {
        const ocText =
          r.ocLines.length > 0 ? r.ocLines.join(' · ') : 'Sin OC activa';
        doc.text(`• ${r.correlative} (${r.status}): ${ocText}`, {
          width,
        });
        doc.moveDown(0.35);
      }
      doc.moveDown(0.5);
    }

    doc.fontSize(12).text('Distribución del gasto por imputación', {
      underline: true,
    });
    doc.moveDown(0.5);
    const imp = data.imputationSpend;
    const impSum = imp.general + imp.equipment + imp.workOrder || 1;
    const rowsImp: [string, number][] = [
      ['Gasto general', imp.general],
      ['Por equipo', imp.equipment],
      ['Por orden de trabajo', imp.workOrder],
    ];
    doc.fontSize(9).fillColor('#333333');
    for (const [label, amt] of rowsImp) {
      const pct = impSum > 0 ? (amt / impSum) * 100 : 0;
      const rowY = doc.y;
      doc.text(label, left, rowY, { width: 200 });
      doc.text(formatClp(amt), left + 210, rowY, { width: width - 220 });
      doc.y = rowY + 14;
      doc.fontSize(8).fillColor('#666666').text(barAscii(pct), left);
      doc.fontSize(9).fillColor('#333333');
      doc.moveDown(0.55);
    }
    doc.moveDown(0.5);

    doc.fontSize(12).fillColor('#000000').text('Top proveedores por volumen', {
      underline: true,
    });
    doc.moveDown(0.5);

    const volSum =
      data.topVendors.reduce((s, v) => s + v.purchaseVolume, 0) || 1;
    doc.fontSize(9);
    const headY = doc.y;
    doc.text('Proveedor', left, headY, { width: width * 0.44 });
    doc.text('Volumen', left + width * 0.45, headY, { width: width * 0.24 });
    doc.text('% s/ top', left + width * 0.72, headY, { width: width * 0.26 });
    doc.moveDown(0.4);
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .stroke('#dddddd');
    doc.moveDown(0.3);

    for (const v of data.topVendors) {
      const share = volSum > 0 ? (v.purchaseVolume / volSum) * 100 : 0;
      const line = doc.y;
      doc
        .fontSize(8)
        .fillColor('#222222')
        .text(`${v.vendorCode} — ${v.vendorName}`, left, line, {
          width: width * 0.44,
        });
      doc.text(formatClp(v.purchaseVolume), left + width * 0.46, line, {
        width: width * 0.22,
      });
      doc.text(`${share.toFixed(1)} %`, left + width * 0.7, line, {
        width: width * 0.2,
      });
      doc.moveDown(0.35);
      doc
        .fontSize(7)
        .fillColor('#888888')
        .text(barAscii(share, 28), left, doc.y);
      doc.moveDown(0.45);
    }

    doc.addPage();
    doc
      .fontSize(12)
      .fillColor('#000000')
      .text('Detalle de eficiencia — lead time por proveedor', {
        underline: true,
      });
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor('#333333');
    for (const v of data.topVendors) {
      const lt =
        v.avgLeadTimeDays != null
          ? `${v.avgLeadTimeDays} días`
          : 'Sin recepciones en período';
      doc.text(`• ${v.vendorName} (${v.vendorCode}): ${lt}`, { width });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.8);

    doc.fontSize(12).text('Notas de control — facturación y 3-way match', {
      underline: true,
    });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#333333');
    doc.text(
      `En el período se registraron ${data.kpis.invoiceDiscrepancyCount} factura(s) con discrepancia ` +
        `sobre ${data.kpis.invoiceTotalForRate} validada(s) para tasa ${formatPct(data.kpis.invoiceDiscrepancyRate)}.`,
      { width },
    );
    doc.moveDown(0.5);
    doc.text(
      `El monto acumulado asociado a prevención de sobrepagos (correcciones tras discrepancia) es ${formatClp(data.overpaymentPrevention)}.`,
      { width },
    );
    doc.moveDown(0.5);
    doc
      .fontSize(8)
      .fillColor('#666666')
      .text(
        'Las discrepancias indican diferencias entre OC, recepción en bodega y monto facturado, ' +
          'según la política de margen configurada en Compras.',
        { width },
      );

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#999999')
      .text(
        `Documento generado ${new Date().toLocaleString('es-CL')} · ${tenantName}`,
        { align: 'center' },
      );

    doc.end();
  });
}
