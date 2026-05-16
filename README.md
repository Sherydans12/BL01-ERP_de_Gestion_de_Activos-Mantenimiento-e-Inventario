# TPM — Gestión de activos y EAM

Sistema orientado a entornos industriales para el control de flota, mantenimiento preventivo y correctivo, e inventario valorizado mediante costo promedio ponderado (CPP).

## Estado del proyecto

**Fase actual:** D — Hardening y lógica EAM.

**Cierre v1.1 (Platinum — storage):** Archivos en Cloudflare R2 con modelo **private-first**; punteros relativos en BD; runbook operativo en [docs/SECURITY-STORAGE.md](docs/SECURITY-STORAGE.md).

**v1.2 — Gobernanza de compras por ACL de usuarios y control de umbrales económicos (`minAmount`):** políticas de aprobación por lista explícita de firmantes (`approval_policy_users`), validación de monto mínimo por nivel al firmar OC, y panel de configuración alineado; detalle en [docs/PURCHASE-GOVERNANCE.md](docs/PURCHASE-GOVERNANCE.md).

**v1.3 — Flujos de compras y catálogo en SRC/recepción:** documento único de flujos operativos (líneas con catálogo, cantidad editable y validada, cadena hasta recepción, un solo botón «Generar orden(es) de compra» en detalle SRC, códigos de inventario `IN####` y sin autogenerar N° de parte en quick-create) en [docs/PURCHASE-FLOWS.md](docs/PURCHASE-FLOWS.md).

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

## Desarrollo con IA (Cursor)

- Índice y convenciones para el asistente: [AGENTS.md](AGENTS.md).
- Reglas siempre activas: `.cursor/rules/` (`tpm-arquitectura.mdc`, `erp-bl01-context.mdc`).
- Memoria de equipo (decisiones, glosario): [docs/agentes/](docs/agentes/README.md).

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

### Almacenamiento de archivos (R2 / local)

- **Fuente de verdad:** En base de datos se guarda la **clave relativa de objeto** (`storageKey` o campos equivalentes como `avatarUrl`, `attachmentUrl`, `pdfUrl`), por ejemplo `user-avatars/…`, `purchase-docs/…` o rutas bajo prefijo de tenant tras migración. No se persiste como contrato la URL pública `https://…` del bucket; si existen filas legacy con URL absoluta, el backend las tolera al leer, pero el modelo objetivo es clave relativa.
- **Acceso private-first (R2):** El bucket no se expone como sitio público; la lectura pasa por el backend (`GET /api/storage/resolve` con JWT y comprobación de tenant) o por **URLs firmadas** generadas al vuelo. Para descargas directas vía `StorageService.getReadOnlyUrl` con driver S3/R2, la vigencia actual de la firma es **5 minutos** (300 s); el cliente debe refrescar la vista o volver a solicitar el recurso si expira.
- **Desarrollo local:** Con `STORAGE_DRIVER` omitido o `local`, los archivos viven bajo `UPLOAD_PATH` y se sirven vía ruta `/uploads/…`; en producción con R2 conviene un volumen persistente solo mientras coexista legado local.
- **Operación y rotación de claves:** [docs/SECURITY-STORAGE.md](docs/SECURITY-STORAGE.md) (incluye runbook R2, limpieza de `/uploads` y roadmap de garbage collection).

Verificación post-migración (punteros no vacíos en columnas críticas):

```bash
cd backend && npm run storage:verify:db
```

## Hoja de ruta

- **Fase E:** Panel de costos de mantenimiento y analítica de disponibilidad.
- **Fase F:** Despliegue en producción (VPS Ubuntu) con Nginx y SSL.
