import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export type InventoryLabelSize = '50x25' | '100x50';

export type InventoryLabelQrMode = 'url' | 'json';

export type InventoryLabelInput = {
  inventoryCode: string | null;
  partNumber: string;
  name: string;
  qrPayload: string;
  size: InventoryLabelSize;
};

const MM_TO_PT = 72 / 25.4;

function mm(n: number): number {
  return n * MM_TO_PT;
}

function truncate(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * PDF de etiqueta térmica: texto + QR (payload ya resuelto: URL o JSON).
 */
export async function generateInventoryItemLabelPdfBuffer(
  input: InventoryLabelInput,
): Promise<Buffer> {
  const w = input.size === '50x25' ? mm(50) : mm(100);
  const h = input.size === '50x25' ? mm(25) : mm(50);

  const qrPixelSize = input.size === '50x25' ? 120 : 240;
  const qrBuffer = await QRCode.toBuffer(input.qrPayload, {
    type: 'png',
    width: qrPixelSize,
    margin: 0,
    errorCorrectionLevel: 'M',
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [w, h],
      margin: 0,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pad = input.size === '50x25' ? 3 : 8;
    const sku = input.inventoryCode?.trim() || '—';
    const nameTrunc = truncate(input.name, input.size === '50x25' ? 28 : 48);
    const pn = input.partNumber.trim() || '—';

    if (input.size === '100x50') {
      const qrDraw = Math.min(mm(42), h - pad * 2);
      const qrX = w - pad - qrDraw;
      const qrY = (h - qrDraw) / 2;

      doc.image(qrBuffer, qrX, qrY, { width: qrDraw, height: qrDraw });

      doc
        .fillColor('#111111')
        .font('Helvetica-Bold')
        .fontSize(17)
        .text(sku, pad, pad + 2, {
          width: qrX - pad * 2,
          lineBreak: false,
        });

      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#333333')
        .text(nameTrunc, pad, pad + 30, {
          width: qrX - pad * 2,
          lineBreak: true,
        });

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#555555')
        .text(`N° parte: ${pn}`, pad, h - pad - 18, {
          width: qrX - pad * 2,
        });
    } else {
      const qrDraw = Math.min(mm(17), h - pad * 2);
      const qrX = w - pad - qrDraw;
      const qrY = (h - qrDraw) / 2;

      doc.image(qrBuffer, qrX, qrY, { width: qrDraw, height: qrDraw });

      doc
        .fillColor('#111111')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(sku, pad, pad, {
          width: qrX - pad * 2,
          lineBreak: false,
        });

      doc
        .font('Helvetica')
        .fontSize(5.5)
        .fillColor('#333333')
        .text(nameTrunc, pad, pad + 11, {
          width: qrX - pad * 2,
          lineBreak: false,
        });

      doc
        .font('Helvetica')
        .fontSize(6)
        .fillColor('#555555')
        .text(`Ref: ${pn}`, pad, h - pad - 7, {
          width: qrX - pad * 2,
          lineBreak: false,
        });
    }

    doc.end();
  });
}
