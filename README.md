# TPM — Gestión de activos y EAM

Sistema orientado a entornos industriales para el control de flota, mantenimiento preventivo y correctivo, e inventario valorizado mediante costo promedio ponderado (CPP).

## Estado del proyecto

**Fase actual:** D — Hardening y lógica EAM.

Funcionalidades principales:

- **Maestro de flota:** Activos con trazabilidad de horómetros y ajustes físicos (offsets).
- **Mantenimiento (fase B):** Órdenes de trabajo, kits de mantenimiento y pautas dinámicas.
- **Inventario y bodega (fase C):** Catálogo global, multibodega por contrato, kardex inmutable y valorización por CPP.
- **Hardening (fase D):** Consumo atómico de stock, reservas de materiales y soporte de stock negativo para continuidad operativa.

## Stack tecnológico

| Capa        | Tecnología                          |
| ----------- | ----------------------------------- |
| Frontend    | Angular 18                          |
| Backend     | NestJS 11                           |
| Base de datos | PostgreSQL 16 (Docker), Prisma   |

## Requisitos

- Node.js 20 LTS o superior
- Docker Desktop (PostgreSQL en contenedor)
- Angular CLI 18 o superior (para desarrollo del frontend)

## Instalación y desarrollo local

### 1. Clonar el repositorio

```bash
git clone https://github.com/Sherydans12/BL01-ERP_de_Gestion_de_Activos-Mantenimiento-e-Inventario.git
cd BL01-ERP_de_Gestion_de_Activos-Mantenimiento-e-Inventario
```

### 2. Base de datos (Docker)

```bash
docker-compose up -d
```

### 3. Backend

```bash
cd backend
npm install
npx prisma migrate dev
npm run start:dev
```

### 4. Frontend

En otra terminal, desde la raíz del repositorio:

```bash
cd frontend
npm install
npm start
```

### PWA y Service Worker (HTTPS en producción)

El Service Worker de Angular (caché offline, notificaciones push) **requiere HTTPS** en producción. La excepción habitual es **`http://localhost`** durante el desarrollo local; sin un origen seguro, el navegador no activará el SW de forma fiable.

## Principios de diseño de datos

- **Multi-tenancy:** Aislamiento por empresa (`tenantId`).
- **Seguridad operativa:** Segregación por contratos (faenas) y subcontratos.
- **Consumo atómico:** Los repuestos se descuentan al cerrar la orden de trabajo mediante transacciones de base de datos (`$transaction`).

## Hoja de ruta

- **Fase E:** Panel de costos de mantenimiento y analítica de disponibilidad.
- **Fase F:** Despliegue en producción (VPS Ubuntu) con Nginx y SSL.
