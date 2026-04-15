import PDFDocument from 'pdfkit';

type PoPdfOrder = {
  correlative: string;
  status: string;
  totalAmount: { toString: () => string };
  currency: string;
  createdAt: Date;
  contract?: { code?: string; name?: string } | null;
  subcontract?: { code?: string; name?: string } | null;
  quotation?: { vendor?: { name?: string; code?: string } | null } | null;
  equipment?: {
    internalId: string;
    brand: string;
    model: string;
    plate?: string | null;
  } | null;
  workOrder?: { correlative: string; description: string } | null;
  items: Array<{
    description: string;
    quantity: unknown;
    unitCost: { toString: () => string };
    inventoryItem?: { partNumber?: string; name?: string } | null;
  }>;
};

function formatMoney(n: number, currency: string): string {
  try {
    return `${currency} ${n.toLocaleString('es-CL', { maximumFractionDigits: 0 })}`;
  } catch {
    return `${currency} ${n}`;
  }
}

function equipmentLine(eq: NonNullable<PoPdfOrder['equipment']>): string {
  const label = [eq.brand, eq.model].filter(Boolean).join(' ').trim();
  return label ? `${eq.internalId} (${label})` : eq.internalId;
}

/**
 * PDF operativo de la OC: bloque **Destino** para bodega / faena.
 */
export function generatePurchaseOrderPdfBuffer(
  order: PoPdfOrder,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc
      .fontSize(18)
      .fillColor('#333333')
      .text('ORDEN DE COMPRA', { align: 'center' });
    doc.moveDown(0.3);
    doc
      .fontSize(11)
      .fillColor('#666666')
      .text(order.correlative, { align: 'center' });
    doc.moveDown(1);

    const hasAssetLink = !!(order.equipment || order.workOrder);
    const destinoMain = hasAssetLink
      ? `Destino: ${order.equipment ? equipmentLine(order.equipment) : '—'} | OT: ${order.workOrder?.correlative ?? '—'}`
      : 'Destino: Gasto general / no asociado a activo';

    doc.save();
    const boxY = doc.y;
    const boxH = hasAssetLink && order.workOrder?.description ? 56 : 40;
    doc.roundedRect(left, boxY, width, boxH, 4).stroke('#bbbbbb');
    doc
      .fillColor('#111111')
      .fontSize(10)
      .text(destinoMain, left + 10, boxY + 10, {
        width: width - 20,
      });
    if (hasAssetLink && order.workOrder?.description) {
      const short =
        order.workOrder.description.length > 100
          ? `${order.workOrder.description.slice(0, 97)}...`
          : order.workOrder.description;
      doc
        .fontSize(8)
        .fillColor('#555555')
        .text(`Referencia OT: ${short}`, left + 10, boxY + 30, {
          width: width - 20,
        });
    }
    doc.restore();
    doc.y = boxY + boxH + 12;

    doc.fontSize(9).fillColor('#444444');
    doc.text(
      `Estado: ${order.status}  ·  Emitido: ${order.createdAt.toLocaleString('es-CL')}`,
      left,
      doc.y,
      { width },
    );
    doc.moveDown(0.6);

    const vendor = order.quotation?.vendor;
    doc.text(
      `Proveedor: ${vendor ? `${vendor.code ?? ''} ${vendor.name ?? ''}`.trim() : '—'}`,
      { width },
    );
    doc.text(
      `Contrato: ${order.contract?.name ?? '—'}${order.subcontract ? ` · Subcontrato: ${order.subcontract.code} — ${order.subcontract.name}` : ''}`,
      { width },
    );
    doc.moveDown(0.6);

    const total = Number(order.totalAmount.toString());
    doc
      .fontSize(11)
      .fillColor('#000000')
      .text(`Total: ${formatMoney(total, order.currency)}`, {
        width,
      });
    doc.moveDown(1);

    doc.fontSize(10).fillColor('#000000').text('Ítems', { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(9).fillColor('#222222');
    for (const line of order.items) {
      const qty = Number(line.quantity);
      const unit = Number(line.unitCost.toString());
      const part = line.inventoryItem?.partNumber
        ? `[${line.inventoryItem.partNumber}] `
        : '';
      doc.text(`${part}${line.description}`, { width });
      doc.fontSize(8).fillColor('#666666');
      doc.text(
        `  Cant.: ${qty}  ·  P. unit.: ${formatMoney(unit, order.currency)}`,
        { width },
      );
      doc.fontSize(9).fillColor('#222222');
      doc.moveDown(0.4);
    }

    doc.moveDown(0.5);
    doc
      .fontSize(7)
      .fillColor('#999999')
      .text(
        'Documento generado electrónicamente. Verifique el destino de imputación antes de despachar a faena.',
        left,
        doc.page.height - doc.page.margins.bottom - 20,
        { width, align: 'center' },
      );

    doc.end();
  });
}
