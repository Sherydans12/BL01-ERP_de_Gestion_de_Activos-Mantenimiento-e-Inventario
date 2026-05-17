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

# 3. Producción (imagen final, usuario sin privilegios + healthcheck)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# curl: solo para HEALTHCHECK (imagen mínima en runtime)
RUN apk add --no-cache curl

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./
COPY --chown=node:node --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
