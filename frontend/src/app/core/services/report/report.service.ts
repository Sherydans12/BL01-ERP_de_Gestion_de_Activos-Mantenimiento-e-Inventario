import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

@Injectable({
  providedIn: 'root',
})
export class ReportService {
  generateOTReport(ot: any): void {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // ── ENCABEZADO ──────────────────────────────────────────
    doc.setFillColor(20, 20, 30);
    doc.rect(0, 0, pageWidth, 42, 'F');

    doc.setFont('courier', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(0, 229, 255); // Cyan #00E5FF
    doc.text(ot.correlative, 14, y + 8);

    doc.setFont('courier', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(160, 160, 170);
    doc.text('ORDEN DE TRABAJO — SISTEMA TPM', 14, y + 16);

    const fecha = new Date(ot.createdAt).toLocaleDateString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    doc.text(`Fecha: ${fecha}`, pageWidth - 14, y + 8, { align: 'right' });
    doc.text(`Estado: ${ot.status}`, pageWidth - 14, y + 16, {
      align: 'right',
    });

    y = 50;

    // ── INFORMACIÓN DEL EQUIPO ──────────────────────────────
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 229, 255);
    doc.text('1. INFORMACIÓN DEL EQUIPO', 14, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      theme: 'grid',
      styles: {
        font: 'courier',
        fontSize: 9,
        cellPadding: 4,
        textColor: [30, 30, 40],
      },
      headStyles: {
        fillColor: [30, 30, 45],
        textColor: [0, 229, 255],
        fontStyle: 'bold',
      },
      head: [['Campo', 'Valor']],
      body: [
        ['ID Interno', ot.equipment?.internalId || '-'],
        ['Tipo', ot.equipment?.type || '-'],
        ['Patente', ot.equipment?.plate || 'N/A'],
        [
          'Marca / Modelo',
          `${ot.equipment?.brand || '-'} ${ot.equipment?.model || ''}`,
        ],
        ['Horómetro Inicial', String(ot.initialHorometer)],
        ['Horómetro Final', String(ot.finalHorometer)],
        ['Tipo OT', ot.type],
        ['Categoría', ot.category],
      ],
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable.finalY + 10;

    // ── SISTEMAS INTERVENIDOS ───────────────────────────────
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 229, 255);
    doc.text('2. SISTEMAS INTERVENIDOS', 14, y);
    y += 3;

    const systemRows = (ot.systems || []).map((s: any, i: number) => [
      String(i + 1),
      s.catalogItem?.name || s.catalogItem?.code || '-',
    ]);

    autoTable(doc, {
      startY: y,
      theme: 'grid',
      styles: {
        font: 'courier',
        fontSize: 9,
        cellPadding: 4,
        textColor: [30, 30, 40],
      },
      headStyles: {
        fillColor: [30, 30, 45],
        textColor: [0, 229, 255],
        fontStyle: 'bold',
      },
      head: [['#', 'Sistema']],
      body:
        systemRows.length > 0
          ? systemRows
          : [['—', 'Sin sistemas registrados']],
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable.finalY + 10;

    // ── DESCRIPCIÓN DEL TRABAJO ─────────────────────────────
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 229, 255);
    doc.text('3. DESCRIPCIÓN DEL TRABAJO', 14, y);
    y += 6;

    doc.setFont('courier', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 60);
    const descLines = doc.splitTextToSize(
      ot.description || 'Sin descripción.',
      pageWidth - 28,
    );
    doc.text(descLines, 14, y);
    y += descLines.length * 4.5 + 8;

    // ── CONSUMO DE FLUIDOS ──────────────────────────────────
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 229, 255);
    doc.text('4. CONSUMO DE FLUIDOS', 14, y);
    y += 3;

    const fluidRows = (ot.fluids || []).map((f: any) => [
      f.catalogItem?.name || '-',
      `${f.liters} Lts`,
      f.action,
    ]);

    autoTable(doc, {
      startY: y,
      theme: 'grid',
      styles: {
        font: 'courier',
        fontSize: 9,
        cellPadding: 4,
        textColor: [30, 30, 40],
      },
      headStyles: {
        fillColor: [30, 30, 45],
        textColor: [0, 229, 255],
        fontStyle: 'bold',
      },
      head: [['Fluido', 'Cantidad', 'Acción']],
      body:
        fluidRows.length > 0
          ? fluidRows
          : [['—', '—', 'Sin consumos registrados']],
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable.finalY + 20;

    // ── FIRMAS ──────────────────────────────────────────────
    // Check if we need a new page for signatures
    if (y > doc.internal.pageSize.getHeight() - 50) {
      doc.addPage();
      y = 20;
    }

    doc.setDrawColor(150, 150, 160);
    doc.setLineWidth(0.3);

    // Firma Mecánico
    const sigY = y + 15;
    doc.line(14, sigY, 90, sigY);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 110);
    doc.text('FIRMA MECÁNICO EJECUTOR', 14, sigY + 5);

    // Firma Supervisor
    doc.line(pageWidth - 90, sigY, pageWidth - 14, sigY);
    doc.text('FIRMA SUPERVISOR / JEFE TALLER', pageWidth - 90, sigY + 5);

    // ── PIE DE PÁGINA ───────────────────────────────────────
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 140);
    doc.text(
      `Documento generado el ${new Date().toLocaleString('es-CL')} — Sistema TPM v1.0`,
      pageWidth / 2,
      pageH - 8,
      { align: 'center' },
    );

    // Guardar
    doc.save(`${ot.correlative}.pdf`);
  }
}
