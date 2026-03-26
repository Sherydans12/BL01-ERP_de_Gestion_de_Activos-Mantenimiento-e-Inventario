import { defineConfig } from '@prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    // Esto es lo que le faltaba para que 'npx prisma db seed' funcione
    seed: 'node dist/prisma/seed.js',
  },
});
