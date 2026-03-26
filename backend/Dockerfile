# 1. Dependencias (Instalación limpia)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
# Instalamos dependencias incluyendo devDeps para el build
RUN npm install

# 2. Build (Compilación y generación de cliente)
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Inyectamos una URL temporal para que Prisma no falle al generar el cliente
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate
RUN npm run build

# 3. Producción (Imagen ligera final)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Solo copiamos lo estrictamente necesario para correr la app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Usamos node directamente para mejor manejo de señales en Docker
CMD ["node", "dist/src/main.js"]