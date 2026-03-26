import { defineConfig } from '@prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Usamos process.env directamente para asegurar la lectura en Docker
    url: process.env.DATABASE_URL,
  },
});
