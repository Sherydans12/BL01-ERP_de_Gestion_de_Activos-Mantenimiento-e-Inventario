# Roadmap: Sistema EAM como un único sistema integrado

**Versión:** 1.0 · **Creado:** 2026-06-03 · **Mantenido por:** Equipo TPM / agentes Cursor

> Documento vivo para planificar y rastrear la integración transversal entre todos los módulos del ERP TPM. El objetivo es que el usuario vea un único sistema cohesionado, no módulos aislados.

---

## Estado actual (post Integración Transversal M1·M2·M3 — 2026-06-03)

| Módulo | Backend | Frontend | Integración con Flota | Integración con OT | Integración con Inventario |
|--------|---------|----------|-----------------------|--------------------|---------------------------|
| **Flota / Equipos** | ✅ completo | ✅ Centro de Mando | — | ✅ OT lista en modal | ✅ Costos en modal |
| **OT (Work Orders)** | ✅ completo | ✅ completo | ✅ `isOperational` + horómetro | — | ✅ consumo en cierre |
| **M1 · Lubricantes** | ✅ completo | ✅ completo | ✅ horómetro (`currentMeter`) | — | ✅ kardex `LUBE_DISPATCH` |
| **M2 · Disponibilidad** | ✅ completo | ✅ completo | ✅ lee `isOperational` | — | — |
| **M3 · Fallas** | ✅ completo | ✅ completo + `invalidateCache` | ✅ `isOperational` + OT auto | ✅ OT no programada auto | — |
| **Inventario / Kardex** | ✅ completo | ✅ completo | parcial (solo en modal) | ✅ `WORK_ORDER_ISSUE` | — |
| **Compras P2P** | ✅ completo | ✅ completo | parcial (costos en modal) | ✅ `AssetCostRecord` en cierre | ✅ recepción → stock |
| **Dashboard** | — | básico | ❌ sin KPIs cruzados | ❌ sin KPIs cruzados | ❌ sin KPIs cruzados |

**Señales SSOT centrales** (ver `MASTER-CONTEXT.md` §2.4):
- `Equipment.currentMeter` — fed por OT, M1, M2, M3
- `Equipment.isOperational` — mutado por OT y M3-ALTA; leído por M2 y la UI de Flota

---

## Fase siguiente — Plan de integración completa

### Prioridad 1: Conexiones faltantes visibles (alto impacto en UX)

#### 1.1 · Dashboard unificado con KPIs cruzados — PARCIAL (Sprint 1, 2026-06-03)

> **Hecho:** tiles de Equipos detenidos (`isOperational=false`), Fallas sin OT (`FaultReport.status=OPEN`) y Sin reporte de turno (`/equipment-availability/unreported` + `ShiftService`). Indicador de turno activo + reloj en el header (`ShiftBadgeComponent`). Métricas backend en `getStats()`.
> **Pendiente:** semáforo de PMs próximas como tile dedicado (la lógica ya existe en `pmDueSoon`), alertas de abastecimiento como tile, widget de OTs `IN_PROGRESS` por equipo.

El dashboard actual no cruza módulos. Objetivo: una pantalla con "estado del sistema" real.

**Conexiones a implementar:**
- **Semáforo de flota**: conteo de equipos `isOperational=false` (M3/OT) con link directo a la lista filtrada.
- **OTs abiertas por equipo**: widget con las OTs en `IN_PROGRESS` que bloquean operación.
- **Alertas de abastecimiento** (`getSupplyAlerts` del servicio de inventario): artículos bajo stock mínimo que podrían impactar el mantenimiento próximo.
- **Próximas PMs**: equipos cuyo `currentMeter >= nextServiceAt - margen` (ya calculado en el modal, reutilizar lógica).
- **Última disponibilidad del turno activo**: badge con "X equipos sin reportar" en el turno actual (usa `GET /equipment-availability/unreported`).

**Archivos clave:**
- `frontend/src/app/features/dashboard/` (ruta `/app/dashboard`)
- Backend: reutilizar endpoints existentes; agregar un posible `GET /api/dashboard-summary` si se optimiza.

#### 1.2 · Pestaña "OTs" en el modal de detalle de equipo — HECHO (Sprint 1, 2026-06-03)

> Nueva pestaña «Órdenes de Trabajo» con carga perezosa vía `getWorkOrdersFiltered({ equipmentId, limit:20 })`: tabla con TODOS los estados (no solo cerradas como el timeline). Click en correlativo abre `WorkOrderDetailModalComponent` **embebido** (no navega, preserva el contexto del equipo). Decisión de UX confirmada con el usuario: modal interno en vez de navegar a `/app/ots/:id`.

El modal de `equipment-detail-modal` tenía un historial de actividad que mezclaba OTs cerradas, ajustes y costos en una timeline genérica. Ahora la pestaña OTs dedicada completa el círculo M3 → OT → cierre → Flota.

#### 1.3 · Banner/indicador en el formulario de OT cuando el equipo tiene fallas OPEN — HECHO (Sprint 1, 2026-06-03)

> Al seleccionar equipo en `work-order-form`, se consulta `getReports({ equipmentId, status: 'OPEN', pageSize: 5 })` (señal `openFaults`). Si hay fallas abiertas, se muestra un banner ámbar (`warning`) con el conteo, el listado de correlativos con badge de criticidad + sistema afectado + fecha, y link a `/app/operaciones/fallas`. Se limpia al deseleccionar equipo. Cierra el círculo M3 → planificación de OT. Spec nuevo `work-order-form.component.spec.ts` (4 tests, sin render de template por tamaño del componente).

Cuando el planificador crea una OT manualmente y selecciona un equipo:
- Si ese equipo tiene un `FaultReport` en estado `OPEN`, mostrar un aviso "Este equipo tiene X fallas sin vincular".
- Hace que el planificador sepa qué reportes de terreno están esperando.
- Fetch a `GET /api/fault-reports?equipmentId=...&status=OPEN&pageSize=5` al seleccionar equipo en el form de OT.

---

### Prioridad 2: Trazabilidad bidireccional (valor medio, no urgente)

#### 2.1 · Consumo de inventario en el modal de equipo — HECHO (Sprint 2, 2026-06-03)

> El tab «Consumos» del modal ahora muestra **dos secciones**: «Lubricantes» (M1, últimos 5 despachos — sin cambios) y «Repuestos usados en OTs» (nuevo). Los repuestos se derivan de `analytics.workOrders[].parts` (`computed partsConsumed`) — el backend ahora incluye `parts` (`partNumber`, `description`, `quantity`, `unitCost`, `inventoryItemId`) en `getAnalytics`. Cada fila linkea al `WorkOrderDetailModal` embebido (reusa `openOtDetail` del Sprint 1) y muestra costo de línea (`quantity × unitCost`); subtotal de repuestos en el encabezado vía `partsTotalCost`. Sin endpoint nuevo (regla del roadmap). Specs: +1 backend (`getAnalytics` incluye parts), +3 frontend (`partsConsumed`/`partsTotalCost`).

En la pestaña "Consumos" del modal de detalle, actualmente solo aparecen lubricantes (M1). Ampliar con:
- **Repuestos usados en OTs**: piezas despachadas desde el kardex al cerrar OTs (`WORK_ORDER_ISSUE`). La data existe en `analytics.workOrders` → `parts`.
- Unificar lubricantes + repuestos en una vista "Consumos del activo" agrupada por período.

#### 2.2 · Costos directos en el equipo (lifecycle cost)
`AssetCostRecord` ya se imputa desde OTs y lubricantes. Falta:
- **Widget de costo acumulado** en el modal (tab "Costos"): suma de `AssetCostRecord.amount` agrupado por `AssetCostType` (`WORK_ORDER`, `LUBE_DISPATCH`, `EXTERNAL_PURCHASE`).
- Esto convierte el modal en un centro de lifecycle cost completo.

#### 2.3 · Estado del abastecimiento en el formulario de OT
Al agregar repuestos a una OT, mostrar el stock disponible en bodega para cada ítem seleccionado. El `InventoryStockService` ya expone el stock por bodega. Reducir fricciones: si stock=0, advertir antes de cerrar.

---

### Prioridad 3: Notificaciones push integradas (extensión futura)

#### 3.1 · Push cuando equipo queda fuera de servicio
`FaultReport` HIGH → `isOperational=false`. Disparar Web Push al supervisor del contrato.
- Usar `NotificationDispatcherService` con nuevo `eventKey: 'EQUIPMENT_DOWN'`.
- Registrar en `docs/agentes/notificaciones-sistema.md`.

#### 3.2 · Push cuando se acerca la PM
`currentMeter >= nextServiceAt - 50 hrs` (configurable por `pmIntervalOverride`). Disparar alerta al planificador.
- Punto de disparo: cada vez que `applyCurrentMeterChange` avanza el medidor (en M1, M2, M3 y OT).
- Verificar que no genere spam (una sola notificación por intervalo).

---

## Guía de trabajo para la próxima sesión de integración

### Checklist previo antes de empezar
1. Leer `MASTER-CONTEXT.md` §2.4 (señales SSOT).
2. Verificar `npm run test:domain` (backend) y `npm run test:ci` (frontend) en verde.
3. Revisar qué endpoints ya existen vs. qué hay que crear con la tabla §2.1 de `MASTER-CONTEXT.md`.

### Convención de trabajo entre módulos
- **No crear servicios HTTP nuevos** si el endpoint ya existe — reutilizar el servicio Angular existente.
- **No crear tablas nuevas** para derivar datos que ya existen — calcular en la capa de servicio (ver decisión M2 `isAvailableStatus()`).
- **No duplicar lógica de negocio** del backend en el frontend — los módulos Angular leen y muestran; las reglas viven en Nest/Prisma.
- **Siempre registrar la decisión** en `docs/agentes/decisiones.md` antes de cerrar una tarea.

### Orden sugerido de implementación
```
Sprint 1 (1-2 sesiones):
  └─ 1.1 Dashboard KPIs cruzados (semáforo flota + PMs próximas + sin reporte)
  └─ 1.2 Pestaña OTs dedicada en modal de equipo + links

Sprint 2:
  └─ 1.3 Banner fallas OPEN en formulario de OT
  └─ 2.1 Consumos unificados (lubricantes + repuestos)

Sprint 3:
  └─ 2.2 Widget lifecycle cost en modal
  └─ 2.3 Stock disponible en formulario OT al agregar repuestos

Sprint 4 (cuando el sistema esté estable):
  └─ 3.1 Push EQUIPMENT_DOWN
  └─ 3.2 Push PM próxima
```

---

## Criterio de "sistema completo"

El sistema se considera integrado como una unidad cuando:
- [ ] Abrir la app y en **< 5 segundos** el usuario puede ver qué equipos están detenidos, por qué y cuándo fue la última intervención.
- [ ] Desde el modal de cualquier equipo, el usuario puede navegar a su última OT, su última falla, su último parte de turno y su último lubricante — sin salir del contexto.
- [ ] El planificador crea una OT y ya sabe cuál es el stock disponible de los repuestos que necesita.
- [ ] El supervisor reporta disponibilidad y el dashboard se actualiza sin recargar la página.

---

*Enlazado desde: [`AGENTS.md`](../../AGENTS.md), [`docs/agentes/README.md`](README.md), [`decisiones.md`](decisiones.md)*
