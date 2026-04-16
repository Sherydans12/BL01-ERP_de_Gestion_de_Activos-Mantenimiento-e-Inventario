import PDFDocument from 'pdfkit';

export type PhysicalCountSheetRow = {
  inventoryCode: string;
  partNumber: string;
  description: string;
  location: string;
};

function sortRowsByLocation(rows: PhysicalCountSheetRow[]): PhysicalCountSheetRow[] {
  return [...rows].sort((a, b) => {
    const ka = (a.location ?? '').trim() || '\uffff';
    const kb = (b.location ?? '').trim() || '\uffff';
    const c = ka.localeCompare(kb, 'es', { sensitivity: 'base' });
    if (c !== 0) return c;
    return a.partNumber.localeCompare(b.partNumber, 'es', { sensitivity: 'base' });
  });
}

const SIGNATURE_BLOCK_HEIGHT = 130;

/**
 * Hoja de conteo físico a ciegas: sin columna de stock sistema.
 */
export function generatePhysicalCountSheetPdfBuffer(data: {
  warehouseCode: string;
  warehouseName: string;
  generatedAt: Date;
  rows: PhysicalCountSheetRow[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      layout: 'landscape',
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const sorted = sortRowsByLocation(data.rows);
    const left = doc.page.margins.left;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;
    const usableW =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const whTitle = `${data.warehouseCode} — ${data.warehouseName}`.trim();
    const generatedStr = data.generatedAt.toLocaleString('es-CL', {
      dateStyle: 'full',
      timeStyle: 'short',
    });

    doc.fontSize(18).fillColor('#111').font('Helvetica-Bold');
    doc.text('HOJA DE CONTEO FÍSICO (CIEGA)', left, doc.y, { width: usableW });
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(12).fillColor('#1a1a1a');
    doc.text(`Bodega: ${whTitle}`, { width: usableW });
    doc.moveDown(0.35);
    doc.fontSize(10).fillColor('#333');
    doc.text(`Fecha y hora de generación: ${generatedStr}`, { width: usableW });
    doc.moveDown(0.85);
    doc.fontSize(8).fillColor('#666');
    doc.text(
      'Instrucción: registre la cantidad física contada en cada línea. Este documento no muestra el saldo del sistema.',
      { width: usableW },
    );
    doc.moveDown(0.55);

    const col = {
      code: left,
      part: left + usableW * 0.12,
      desc: left + usableW * 0.26,
      loc: left + usableW * 0.56,
      qty: left + usableW * 0.76,
    };
    const wCode = usableW * 0.12;
    const wPart = usableW * 0.14;
    const wDesc = usableW * 0.3;
    const wLoc = usableW * 0.2;
    const wQty = usableW * 0.22;

    let y = doc.y;
    const headerH = 18;
    doc.fontSize(8).fillColor('#000').font('Helvetica-Bold');
    doc.rect(left, y, usableW, headerH).fillAndStroke('#f0f0f0', '#ccc');
    doc.fillColor('#111');
    doc.text('Cód. inventario', col.code + 4, y + 5, { width: wCode - 8 });
    doc.text('N° parte', col.part + 4, y + 5, { width: wPart - 8 });
    doc.text('Descripción', col.desc + 4, y + 5, { width: wDesc - 8 });
    doc.text('Ubicación', col.loc + 4, y + 5, { width: wLoc - 8 });
    doc.text('Cantidad real', col.qty + 4, y + 5, { width: wQty - 8 });
    y += headerH + 2;

    const rowH = 22;
    doc.font('Helvetica').fontSize(8).fillColor('#222');

    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      if (y + rowH > bottomLimit - 12) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc
        .moveTo(col.qty + 4, y + rowH - 4)
        .lineTo(col.qty + wQty - 12, y + rowH - 4)
        .strokeColor('#888')
        .lineWidth(0.5)
        .stroke();

      const desc = (r.description ?? '').trim() || '—';
      doc.text(r.inventoryCode || '—', col.code + 4, y + 4, { width: wCode - 8 });
      doc.text(r.partNumber || '—', col.part + 4, y + 4, { width: wPart - 8 });
      doc.text(desc, col.desc + 4, y + 4, {
        width: wDesc - 8,
        height: rowH - 6,
        ellipsis: true,
      });
      doc.text((r.location ?? '').trim() || '—', col.loc + 4, y + 4, {
        width: wLoc - 8,
      });
      y += rowH;
    }

    /* Firma al final (nueva página si no cabe) */
    const pageBottom = () => doc.page.height - doc.page.margins.bottom;
    if (y + SIGNATURE_BLOCK_HEIGHT > pageBottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    } else {
      y += 16;
    }

    const sigLeft = left;
    const sigW = Math.min(usableW, 420);
    doc.fontSize(10).fillColor('#111').font('Helvetica-Bold');
    doc.text('Cierre de conteo', sigLeft, y, { width: sigW });
    y = doc.y + 8;
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text(
      'Declaro que las cantidades anotadas corresponden al conteo físico realizado en bodega.',
      sigLeft,
      y,
      { width: sigW },
    );
    y = doc.y + 18;
    doc.text('Nombre y firma del responsable del conteo:', sigLeft, y);
    y = doc.y + 8;
    doc
      .moveTo(sigLeft, y + 36)
      .lineTo(sigLeft + 340, y + 36)
      .strokeColor('#444')
      .lineWidth(0.75)
      .stroke();
    y += 48;
    doc.fontSize(9).text('Fecha: ____________________', sigLeft, y);

    doc.end();
  });
}
