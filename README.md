# 🚛 TPM - Asset Management & EAM Enterprise Suite

Sistema de gestión de activos de clase industrial diseñado para el control de flota, mantenimiento preventivo/correctivo e inventario valorizado (CPP).

## 🚀 Estado del Proyecto: Fase D - Hardening & EAM Logic

El sistema cuenta actualmente con:

- Maestro de Flota: Control de activos con trazabilidad de horómetros y ajustes físicos (Offsets).
- Mantenimiento (Fase B): Gestión de OTs, Kits de mantenimiento y pautas dinámicas.
- Inventario & Bodega (Fase C): Catálogo global, multibodega por contrato, Kárdex inmutable y valorización por Costo Promedio Ponderado.
- Hardening (Fase D): Consumo atómico de stock, reservas de materiales y soporte de stock negativo para continuidad operacional.

## 🛠️ Requisitos Previos

- Node.js (v20+ LTS)
- Docker Desktop (Para base de datos PostgreSQL)
- Angular CLI (v18+)

## 📦 Instalación y Desarrollo Local

1. Clonar y Preparar:
   git clone https://github.com/Sherydans12/BL01-ERP_de_Gestion_de_Activos-Mantenimiento-e-Inventario.git
   cd BL01-ERP_de_Gestion_de_Activos-Mantenimiento-e-Inventario

2. Infraestructura (Docker):
   docker-compose up -d

3. Backend:
   cd backend
   npm install
   npx prisma migrate dev
   npm run start:dev

4. Frontend:
   cd ../frontend
   npm install
   npm start

## 🏗️ Arquitectura de Datos (Pilares)

- Multi-tenancy: Aislamiento total por empresa (tenantId).
- Seguridad Operacional: Segregación por Contratos (Faenas) y Subcontratos.
- Consumo Atómico: Los repuestos se descuentan al cerrar la OT mediante transacciones de base de datos ($transaction).

## 🗺️ Próximos Pasos

- Fase E: Dashboard de Costos de Mantenimiento y Analítica de Disponibilidad.
- Fase F: Despliegue en Producción (VPS Ubuntu) con Nginx e SSL.

---

### 3. Prompt para el Agente: Preparación para Despliegue (VPS)

### MISIÓN: Preparación de Código para Despliegue en Producción (VPS Ubuntu)

El sistema ha superado la Fase D y es estable. Ahora necesitamos preparar el repositorio para ser desplegado en un VPS Hostinger (Ubuntu, KVM 4). El objetivo es mantener la capacidad de desarrollo local pero permitir una configuración robusta para producción.

**Tareas Requeridas:**

1. Configuración de Variables de Entorno:
   - Estandariza el uso de archivos .env en el backend. Asegúrate de que la URL de la base de datos, el JWT_SECRET y los puertos sean configurables.
   - Crea un archivo frontend/src/environments/environment.prod.ts que apunte a la IP/Dominio del VPS.

2. Dockerización para Producción:
   - Crea un archivo docker-compose.prod.yml que levante:
     - El contenedor de PostgreSQL.
     - El contenedor del Backend (NestJS) usando un Dockerfile multietapa (build -> production).
     - Un contenedor Nginx que sirva el Frontend (Angular build) y actúe como Reverse Proxy para el API del Backend.

3. Scripts de Deployment:
   - Crea un script simple deploy.sh en la raíz que ejecute el pull de git, levante los contenedores y corra las migraciones de Prisma automáticamente.

4. Optimización de NestJS:
   - Configura el main.ts para habilitar CORS de forma segura y manejar el prefijo /api de forma consistente para el proxy de Nginx.

5. PM2 Config (Opcional pero recomendado):
   - Si no usamos Docker para el proceso de Node, prepara un archivo ecosystem.config.js para gestionar el proceso con PM2 en el VPS.

**Restricción:** El sistema debe seguir funcionando en local con el comando "npm run start:dev" y el docker-compose.yml estándar de desarrollo. No rompas el flujo actual.
