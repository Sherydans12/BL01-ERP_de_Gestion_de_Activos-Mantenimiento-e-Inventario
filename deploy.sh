#!/bin/bash

echo "🚀 Iniciando despliegue de TP-ERP..."

# 1. Actualizar código
echo "📥 Descargando última versión de GitHub..."
git pull origin main

# 2. Reconstruir e Iniciar contenedores
echo "🏗️ Levantando contenedores de producción..."
docker-compose -f docker-compose.prod.yml up -d --build

# 3. Aplicar migraciones de base de datos
echo "🔄 Sincronizando esquema de base de datos (Prisma)..."
docker exec erp-backend-prod npx prisma migrate deploy

# 4. Limpieza (Opcional)
echo "🧹 Limpiando imágenes antiguas..."
docker image prune -f

echo "✅ Despliegue completado con éxito en el puerto 80."
