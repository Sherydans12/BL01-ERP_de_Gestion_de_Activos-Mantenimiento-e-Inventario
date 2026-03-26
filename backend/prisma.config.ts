import 'dotenv/config';
import { defineConfig, env } from '@prisma/config';

// Definimos un fallback para evitar errores en tiempo de build (Docker)
const dbUrl =
  process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: dbUrl,
  },
});
