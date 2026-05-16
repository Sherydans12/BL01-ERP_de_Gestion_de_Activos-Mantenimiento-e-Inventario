import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Opciones para correlativos (además del cliente de transacción). */
export type NextCorrelativeFormat = {
  tx?: any;
  /** Ancho del número (default 5: OC, WR, SRC). */
  padWidth?: number;
  /** Separador entre prefijo y número (default `-`). Vacío concatena: `IN0001`. */
  separator?: string;
};

function isNextCorrelativeFormat(
  v: unknown,
): v is NextCorrelativeFormat {
  if (v == null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    'padWidth' in o ||
    'separator' in o ||
    (Object.keys(o).length === 1 && 'tx' in o)
  );
}

@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Genera el siguiente correlativo atómicamente dentro de una transacción.
   * El caller DEBE pasar el `tx` desde su `$transaction` para garantizar
   * que el upsert del contador y el create del documento sean atómicos.
   *
   * Cuarto argumento: cliente `tx` de Prisma **o** objeto `{ tx?, padWidth?, separator? }`.
   * Default numérico: prefijo + `-` + 5 dígitos (p. ej. `OC-00001`).
   */
  async getNextCorrelative(
    tenantId: string,
    documentType: string,
    prefix: string,
    fourth?: any,
  ): Promise<string> {
    let tx: any;
    let padWidth = 5;
    let separator = '-';
    if (fourth != null && typeof fourth === 'object' && isNextCorrelativeFormat(fourth)) {
      tx = fourth.tx;
      padWidth = fourth.padWidth ?? 5;
      separator = fourth.separator ?? '-';
    } else {
      tx = fourth;
    }

    const client = tx ?? this.prisma;

    const counter = await client.sequenceCounter.upsert({
      where: {
        tenantId_documentType: { tenantId, documentType },
      },
      create: { tenantId, documentType, prefix, lastNumber: 1 },
      update: { lastNumber: { increment: 1 }, prefix },
    });

    const num = String(counter.lastNumber).padStart(padWidth, '0');
    if (separator === '') {
      return `${prefix}${num}`;
    }
    return `${prefix}${separator}${num}`;
  }
}
