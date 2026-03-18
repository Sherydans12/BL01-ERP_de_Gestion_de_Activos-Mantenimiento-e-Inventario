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

  private formatDate(date: any, format: string): string {
    return this.datePipe.transform(date, format) || 'N/A';
  }
}
