# Plan de implementación — M2 Disponibilidad (Monitor + Reporte)

**Fecha:** 2026-06-04  
**Estado:** Implementado (fases 1–5). Pendiente explícito: notificaciones push anti-spam (Sprint 4.2 roadmap).

## Fase 1 — Backend ✅

| ID | Tarea | Estado |
|----|-------|--------|
| 1.1 | ABAC `allowedContracts` en `findAll` + filtro `contractId` | ✅ |
| 1.2 | `GET /equipment-availability/shift-board` | ✅ |
| 1.3 | `GET /unreported` paginado + búsqueda | ✅ |
| 1.4 | `POST /equipment-availability/batch` | ✅ |
| 1.5 | Specs backend (+ shift-board, batch, ABAC) | ✅ |

## Fase 2 — Monitor ✅

| ID | Tarea | Estado |
|----|-------|--------|
| 2.1 | Tipos `ShiftBoard*` en servicio Angular | ✅ |
| 2.2 | Turno auto, filtros contrato/búsqueda | ✅ |
| 2.3 | Tabs Todos / Reportados / Pendientes / Excluidos | ✅ |
| 2.4 | Tabla unificada con estado, horómetro, reportó, hora | ✅ |
| 2.5 | KPIs por estado + % completitud | ✅ |
| 2.6 | Paginación + auto-refresh 5 min | ✅ |
| 2.7 | Export Excel del turno + deep link a formulario | ✅ |
| 2.8 | Specs monitor | ✅ |

## Fase 3 — Reporte de Disponibilidad ✅

| ID | Tarea | Estado |
|----|-------|--------|
| 3.1 | Paginación + búsqueda + filtro contrato | ✅ |
| 3.2 | Toggle vista compacta (tabla) vs cards | ✅ |
| 3.3 | Deep link `?equipmentId=` | ✅ |
| 3.4 | `app-meter-reference-banner` | ✅ |
| 3.5 | Envío via `batch` (éxito parcial) | ✅ |
| 3.6 | Specs form | ✅ |

## Fase 4 — Historial M2 ✅

| ID | Tarea | Estado |
|----|-------|--------|
| 4.1 | `availability-history` component | ✅ |
| 4.2 | Ruta + nav | ✅ |
| 4.3 | Filtros equipo, turno, fechas, contrato, búsqueda | ✅ |

## Fase 5 — Integraciones P2 ✅

| ID | Tarea | Estado |
|----|-------|--------|
| 5.1 | Badge excluidos / `isOperational` en monitor | ✅ |
| 5.2 | Modal ficha equipo desde monitor | ✅ |
| 5.3 | Dashboard KPI → monitor tab PENDING | ✅ |
| 5.4 | KPI desglose por contrato (ADMIN) | ✅ |
| 5.5 | Dashboard `unreportedCount` vía `total` paginado | ✅ |

## Fuera de alcance (roadmap existente)

- Notificación push cuando queden N pendientes antes del cierre de turno → `sistema-integrado-roadmap.md` Sprint 4.2 (requiere schema anti-spam).

## Rutas nuevas / modificadas

- `/app/operaciones/disponibilidad/monitor` — tablero turno
- `/app/operaciones/disponibilidad/nuevo` — carga paginada
- `/app/operaciones/disponibilidad/historial` — **nueva**

## APIs nuevas

- `GET /api/equipment-availability/shift-board`
- `POST /api/equipment-availability/batch`
- `GET /api/equipment-availability/unreported` → respuesta paginada `{ data, total, page, pageSize }`
