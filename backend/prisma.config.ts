import { defineConfig } from '@prisma/config';
import { config } from 'dotenv';

config();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    // Mismo comando que package.json "prisma.seed" (no usar dist/prisma: Nest no compila prisma/)
    seed: 'ts-node prisma/seed.ts',
  },
});
