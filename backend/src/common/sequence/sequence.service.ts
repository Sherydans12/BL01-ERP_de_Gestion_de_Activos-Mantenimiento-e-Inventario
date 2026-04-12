import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Genera el siguiente correlativo atómicamente dentro de una transacción.
   * El caller DEBE pasar el `tx` desde su `$transaction` para garantizar
   * que el upsert del contador y el create del documento sean atómicos.
   */
  async getNextCorrelative(
    tenantId: string,
    documentType: string,
    prefix: string,
    tx?: any,
  ): Promise<string> {
    const client = tx ?? this.prisma;

    const counter = await client.sequenceCounter.upsert({
      where: {
        tenantId_documentType: { tenantId, documentType },
      },
      create: { tenantId, documentType, prefix, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });

    return `${prefix}-${String(counter.lastNumber).padStart(5, '0')}`;
  }
}
