import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DatePipe } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class PdfService {
  private datePipe = new DatePipe('en-US');

  constructor() {}

  /**
   * Genera el PDF de Hoja de Vida del Activo
   * @param equipment Datos del equipo
   * @param history Historial de OTs (últimas 10 cerradas)
   */
  generateEquipmentResume(equipment: any, history: any[]) {
    const doc = new jsPDF();
    const now = new Date();
    const timestamp = this.formatDate(now, 'dd/MM/yyyy HH:mm');

    // --- ENCABEZADO ---
    doc.setFontSize(22);
    doc.setTextColor(255, 51, 102); // Primary Color (TPM Pink)
    doc.text('TPM - Gestión de Activos', 14, 22);

    doc.setFontSize(16);
    doc.setTextColor(40, 40, 40);
    doc.text('REPORTE: HOJA DE VIDA DEL ACTIVO', 14, 32);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Fecha de Emisión: ${timestamp}`, 14, 38);

    doc.setLineWidth(0.5);
    doc.setDrawColor(230, 230, 230);
    doc.line(14, 42, 196, 42);

    // --- SECCIÓN 1: INFORMACIÓN TÉCNICA ---
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text('1. INFORMACIÓN TÉCNICA', 14, 52);

    autoTable(doc, {
      startY: 56,
      theme: 'grid',
      headStyles: { fillColor: [60, 60, 60] },
      body: [
        [
          'N° INTERNO',
          equipment.internalId || 'N/A',
          'PATENTE',
          equipment.plate || 'N/A',
        ],
        ['MARCA', equipment.brand || 'N/A', 'MODELO', equipment.model || 'N/A'],
        [
          'VIN / CHASIS',
          equipment.vin || 'N/A',
          'N° MOTOR',
          equipment.engineNumber || 'N/A',
        ],
        [
          'AÑO',
          equipment.year?.toString() || 'N/A',
          'TIPO',
          equipment.type || 'N/A',
        ],
        [
          'COMBUSTIBLE',
          equipment.fuelType || 'N/A',
          'TRACCIÓN',
          equipment.driveType || 'N/A',
        ],
      ],
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [245, 245, 245], cellWidth: 35 },
        2: { fontStyle: 'bold', fillColor: [245, 245, 245], cellWidth: 35 },
      },
    });

    // --- SECCIÓN 2: ESTADO ACTUAL ---
    const finalY1 = (doc as any).lastAutoTable.finalY + 12;
    doc.text('2. ESTADO ACTUAL Y DOCUMENTACIÓN', 14, finalY1);

    autoTable(doc, {
      startY: finalY1 + 4,
      theme: 'grid',
      body: [
        ['HORÓMETRO ACTUAL', `${equipment.currentHorometer} Hrs/Kms`],
        [
          'REV. TÉCNICA (VTO.)',
          equipment.techReviewExp
            ? this.formatDate(equipment.techReviewExp, 'dd/MM/yyyy')
            : 'SIN REGISTRO',
        ],
        [
          'PERM. CIRCULACIÓN (VTO.)',
          equipment.circPermitExp
            ? this.formatDate(equipment.circPermitExp, 'dd/MM/yyyy')
            : 'SIN REGISTRO',
        ],
      ],
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [245, 245, 245], cellWidth: 60 },
      },
    });

    // --- SECCIÓN 3: HISTORIAL DE MANTENIMIENTO ---
    const finalY2 = (doc as any).lastAutoTable.finalY + 12;
    doc.text(
      '3. HISTORIAL DE MANTENIMIENTO (Últimas 10 Intervenciones)',
      14,
      finalY2,
    );

    if (history && history.length > 0) {
      autoTable(doc, {
        startY: finalY2 + 4,
        theme: 'striped',
        head: [['FECHA', 'ID OT', 'TIPO', 'HORÓMETRO', 'DESCRIPCIÓN']],
        body: history.map((ot) => [
          this.formatDate(ot.closedAt || ot.createdAt, 'dd/MM/yyyy'),
          ot.correlative,
          ot.maintenanceType || 'N/A',
          ot.finalHorometer || ot.initialHorometer,
          ot.description.substring(0, 60) +
            (ot.description.length > 60 ? '...' : ''),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [255, 51, 102] },
      });
    } else {
      doc.setFontSize(10);
      doc.setTextColor(150, 150, 150);
      doc.text(
        'Sin registros de intervenciones de mantenimiento históricos.',
        14,
        finalY2 + 10,
      );
    }

    // --- PIE DE PÁGINA ---
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.line(14, 285, 196, 285);
      doc.text('Generado por Sistema de Gestión de Activos TPM', 14, 290);
      doc.text(`Página ${i} de ${pageCount} | ${timestamp}`, 196, 290, {
        align: 'right',
      });
    }

    // --- DESCARGAR ---
    doc.save(`HOJA_VIDA_${equipment.internalId}_${equipment.plate || ''}.pdf`);
  }

  /**
   * Reporte ejecutivo: valorización global por familia (inventario).
   */
  generateInventoryValuationPdf(
    grandTotal: number,
    byFamily: { familyName: string; totalValue: number }[],
  ) {
    const doc = new jsPDF();
    const ts = this.formatDate(new Date(), 'dd/MM/yyyy HH:mm');

    doc.setFontSize(18);
    doc.setTextColor(40, 40, 40);
    doc.text('Valorización de inventario por familia', 14, 22);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generado: ${ts}`, 14, 30);

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    const totalFmt = new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(grandTotal);
    doc.text(`Valor total inventario: ${totalFmt}`, 14, 40);

    autoTable(doc, {
      startY: 48,
      theme: 'striped',
      head: [['Familia (nivel 1)', 'Valor']],
      body: byFamily.map((r) => [
        r.familyName,
        new Intl.NumberFormat('es-CL', {
          maximumFractionDigits: 0,
        }).format(r.totalValue),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [60, 60, 60] },
    });

    doc.save(`valorizacion_inventario_${Date.now()}.pdf`);
  }

  /**
   * Resumen del requerimiento (SRC) para archivo / auditoría.
   * Si la compra es multiproveedor o por ítem sin ganadora única, la cabecera indica
   * explícitamente «compra fragmentada» en lugar de un único «proveedor seleccionado».
   */
  generatePurchaseRequisitionSummaryPdf(req: {
    correlative: string;
    description?: string;
    status?: string;
    contract?: { name?: string | null };
    subcontract?: { code?: string; name?: string } | null;
    items: Array<{
      description: string;
      quantity: number;
      unitOfMeasure: string;
      awardedQuotationItem?: {
        unitPrice?: number;
        quotation?: {
          vendor?: { name?: string | null };
          currency?: string | null;
        } | null;
      } | null;
    }>;
    quotations?: Array<{
      isWinner?: boolean;
      vendor?: { name?: string | null };
    }>;
    purchaseOrders?: Array<{
      correlative?: string;
      status?: string;
      totalAmount?: number;
      currency?: string;
    }>;
  }): void {
    const doc = new jsPDF();
    const ts = this.formatDate(new Date(), 'dd/MM/yyyy HH:mm');
    const pageWidth = doc.internal.pageSize.getWidth();

    const inactive = new Set(['CANCELLED', 'REJECTED']);
    const activePos = (req.purchaseOrders ?? []).filter(
      (po) => po.status && !inactive.has(String(po.status)),
    );
    const vendorNamesFromAwards = new Set<string>();
    for (const it of req.items ?? []) {
      const n = it.awardedQuotationItem?.quotation?.vendor?.name?.trim();
      if (n) vendorNamesFromAwards.add(n);
    }
    const hasWinner = (req.quotations ?? []).some((q) => q.isWinner);
    const winnerVendor = (req.quotations ?? []).find((q) => q.isWinner)?.vendor
      ?.name;

    const isFragmented =
      activePos.length > 1 ||
      vendorNamesFromAwards.size > 1 ||
      ((req.items ?? []).some((i) => !!i.awardedQuotationItem) &&
        !hasWinner &&
        (req.quotations?.length ?? 0) > 0);

    doc.setFontSize(16);
    doc.setTextColor(30, 30, 40);
    doc.text(`Requerimiento de compra ${req.correlative}`, 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 90);
    doc.text(`Emitido: ${ts}`, pageWidth - 14, 20, { align: 'right' });

    let y = 30;
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    if (isFragmented) {
      doc.setFont('helvetica', 'bold');
      doc.text('Modalidad: compra fragmentada (multiproveedor)', 14, y);
      doc.setFont('helvetica', 'normal');
      y += 6;
      const parts = [...vendorNamesFromAwards].sort();
      const vendorLine =
        parts.length > 0
          ? `Proveedores según adjudicación por ítem (no hay un único proveedor para el total del requerimiento): ${parts.join('; ')}.`
          : 'Las adjudicaciones por ítem y las órdenes de compra asociadas constan en el detalle del sistema; no corresponde un único proveedor global para el total del SRC.';
      const wrapped = doc.splitTextToSize(vendorLine, pageWidth - 28);
      doc.text(wrapped, 14, y);
      y += wrapped.length * 5 + 6;
    } else if (winnerVendor) {
      doc.text(
        `Proveedor de referencia (cotización ganadora): ${winnerVendor}`,
        14,
        y,
      );
      y += 10;
    } else if (vendorNamesFromAwards.size === 1) {
      doc.text(
        `Proveedor adjudicado (oferta por ítem): ${[...vendorNamesFromAwards][0]}`,
        14,
        y,
      );
      y += 10;
    } else {
      const wrapped = doc.splitTextToSize(
        'Sin adjudicación definitiva al momento de la emisión (en proceso o pendiente de ofertas).',
        pageWidth - 28,
      );
      doc.text(wrapped, 14, y);
      y += wrapped.length * 5 + 4;
    }

    doc.setFontSize(10);
    doc.text(`Contrato: ${req.contract?.name ?? '—'}`, 14, y);
    y += 6;
    if (req.subcontract) {
      doc.text(
        `Centro de costos: ${req.subcontract.code} — ${req.subcontract.name}`,
        14,
        y,
      );
      y += 6;
    }
    if (req.description) {
      const dlines = doc.splitTextToSize(
        `Descripción: ${req.description}`,
        pageWidth - 28,
      );
      doc.text(dlines, 14, y);
      y += dlines.length * 5 + 6;
    }

    if (activePos.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Órdenes de compra vinculadas (referencia)', 14, y);
      doc.setFont('helvetica', 'normal');
      y += 5;
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        head: [['OC', 'Estado', 'Monto total', 'Moneda']],
        body: activePos.map((po) => [
          po.correlative ?? '—',
          String(po.status ?? '—'),
          String(po.totalAmount ?? '—'),
          String(po.currency ?? ''),
        ]),
        styles: { fontSize: 9 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    autoTable(doc, {
      startY: y,
      theme: 'striped',
      head: [['Ítem', 'Cant.', 'Ud.', 'P. unit. ref.', 'Proveedor ítem']],
      body: (req.items ?? []).map((it) => {
        const pu = it.awardedQuotationItem?.unitPrice;
        const cur = it.awardedQuotationItem?.quotation?.currency ?? '';
        const puStr =
          pu != null && cur
            ? `${pu} ${cur}`
            : pu != null
              ? String(pu)
              : '—';
        const pv = it.awardedQuotationItem?.quotation?.vendor?.name ?? '—';
        return [
          it.description,
          String(it.quantity),
          it.unitOfMeasure,
          puStr,
          pv,
        ];
      }),
      styles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });

    doc.save(`SRC_${req.correlative}.pdf`);
  }

  private formatDate(date: any, format: string): string {
    return this.datePipe.transform(date, format) || 'N/A';
  }
}
