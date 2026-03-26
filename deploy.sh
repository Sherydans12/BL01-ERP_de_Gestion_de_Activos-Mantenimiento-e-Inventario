#!/bin/bash

# Abortar el script si algún comando falla
set -e

# Configuración de respaldo
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
DB_CONTAINER="erp-postgres-prod"
DB_USER="erp_admin_prod"
DB_NAME="erp_database"

echo "🚀 Iniciando despliegue de TP-ERP..."

# 1. Actualizar código
echo "📥 Descargando última versión de GitHub..."
git pull origin main

# 2. Reconstruir e Iniciar contenedores
echo "🏗️ Levantando contenedores de producción..."
docker compose -f docker-compose.prod.yml up -d --build

# 3. Respaldo de Base de Datos (Seguridad Preventiva)
echo "💾 Realizando respaldo preventivo de la base de datos..."
mkdir -p $BACKUP_DIR
# Usamos docker exec para ejecutar pg_dump dentro del contenedor de Postgres
# La variable PGPASSWORD se toma del entorno del contenedor para no exponerla aquí
docker exec -t $DB_CONTAINER pg_dump -U $DB_USER $DB_NAME > "$BACKUP_DIR/backup_$TIMESTAMP.sql"
echo "✅ Respaldo guardado en: $BACKUP_DIR/backup_$TIMESTAMP.sql"

# 4. Aplicar migraciones de base de datos
echo "🔄 Sincronizando esquema de base de datos (Prisma)..."
docker exec erp-backend-prod npx prisma migrate deploy

# 5. Limpieza (Opcional)
echo "🧹 Limpiando imágenes antiguas..."
docker image prune -f

echo "✅ Despliegue completado con éxito."