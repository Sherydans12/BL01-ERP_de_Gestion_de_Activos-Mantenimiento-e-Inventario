import 'dotenv/config';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // 1. Instanciamos el Pool nativo con la URL real
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // 2. Creamos el adaptador y usamos "as any" para silenciar la estrictez de TS con la librería pg
    const adapter = new PrismaPg(pool as any);

    // 3. Inicializamos el cliente
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
