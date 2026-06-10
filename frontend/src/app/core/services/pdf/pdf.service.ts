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

  private formatDate(date: any, format: string): string {
    return this.datePipe.transform(date, format) || 'N/A';
  }
}
