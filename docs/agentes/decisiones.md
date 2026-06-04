# Decisiones de diseño (ligero)

Añadí entradas con fecha cuando un chat o una reunión fije algo importante. Formato sugerido:

```
## YYYY-MM-DD — Título corto
- Contexto: …
- Decisión: …
- Consecuencias: …
```

## 2026-06-04 — Integridad de fluidos (M1 + OT): stock centralizado, decimales y consumo inusual

- **Contexto:** Auditoría de M1 (Lubricantes) y fluidos en cierre de OT detectó stock negativo permitido por diseño (`isPendingRegularization`), inputs manuales sin visibilidad de disponible, label fijo «Litros» en OT y drift de punto flotante en restas de `ItemStock`.
- **Decisión:**
  - **Núcleo único:** `InventoryStockService.performTransactionCore` con `stock-quantity.util` (`Decimal.js`, epsilon `1e-9`). M1 (`LUBE_DISPATCH`) y OT (`WORK_ORDER_ISSUE`) delegan descuentos; W2W reutiliza el mismo mensaje de insuficiencia.
  - **Flag tenant:** `TenantOperationalConfig.blockNegativeStock` (default `false`). Si `true` → `BadRequestException` en lugar de saldo negativo pendiente.
  - **Frontend shared:** `app-fluid-quantity-row` — badge disponible, validación ámbar/rojo, `step` según `allowsDecimals`, checkbox consumo inusual. Integrado en `lube-report-form` y `work-order-form` (fluidos). Stock del picker vía `stockAvailableQuantity` (sin N+1).
  - **Consumo atípico:** umbral por UoM (~100 LT); `confirmedLargeDispatch` en línea M1 y `confirmedLargeFluidDispatch` al cerrar OT.
  - **Configuración UI:** toggle en **Ajustes → Empresa** (`PATCH /tenant-config/operational`).
- **Consecuencias:** Migración `20260604120000_tenant_block_negative_stock`. Suite dominio **391 tests · 22 suites · 0 fallos**. Columna `ItemStock.quantity` sigue `Float` en DB; precisión en runtime hasta evaluar migración schema.

## 2026-06-03 — Banner de referencia de lectura (Ojo de Seguridad) — Trinidad Operativa

- **Contexto:** Errores de digitación de horómetro/odómetro en terreno alimentan `currentMeter` vía M1, M2, M3, OT y captura masiva. Se requería visibilidad de la última lectura y su fuente antes de cada ingreso.
- **Decisión:**
  - Componente shared `app-meter-reference-banner` (`border-l-4 border-primary bg-primary/10`) con utilidades `getMeterSourceLabel` y `resolveMeterReferenceView`; datos vía `GET /equipments/:id/meter-snapshot` (caché en `EquipmentMeterSnapshotService`) o fila enriquecida de `meter-capture-board` (sin N+1 en tablas masivas).
  - **Puntos de entrada cubiertos:** Registro de Horas (`meter-capture-board` + validación de salto), formulario OT (detención + cierre con `confirmedLargeJump`), **M1 Lubricantes** (bloqueo guardar si lectura &lt; actual), **M3 Fallas** (alerta si lectura &lt; última registrada).
  - Regla de oro sin bitácora: copy *«Sin registros previos — Lectura inicial»*.
- **Consecuencias:** M2 disponibilidad (form + import Excel) y Maestro de Flota quedan como siguiente extensión opcional. Onboarding de datos masivos (Excel) puede reutilizar el mismo patrón de board enriquecido.

## 2026-06-03 — Gestión Configurable de Turnos por Tenant (TenantOperationalConfig)

- **Contexto:** El sistema EAM fue diseñado con `ShiftType` (`DAY` / `NIGHT`), pero el primer cliente solo opera en Turno Día. Se requería que la configuración de turnos fuera por Tenant para no forzar a todos a ver selectores que no usan.
- **Decisión:**
  - **Separación 1:1 (`TenantOperationalConfig`):** Se creó una tabla independiente vinculada a `Tenant` por FK única, con campos `hasNightShift: Boolean @default(true)`, `dayShiftStartTime`, `nightShiftStartTime` y, desde 2026-06-04, `blockNegativeStock: Boolean @default(false)` para controlar stock negativo en M1/OT/inventario.
  - **Lazy-creation:** El registro solo se crea en base de datos al primer `PATCH /tenant-config/operational`; mientras no exista, el backend lee los defaults en memoria (`hasNightShift=true`, `08:00`, `20:00`). Esto evita backfill en tenants existentes.
  - **Backend defensivo (`shift` opcional → default `DAY`):** Los DTOs de disponibilidad (`create`, `export`, `unreported`, `import`) declaran `shift?: ShiftType` con `@IsOptional()`. El helper privado `resolveShift(tenantId, provided?)` en `EquipmentAvailabilityService` aplica la regla: si `hasNightShift=false` e `shift` no se provee → inyecta `DAY`; si se provee `NIGHT` explícitamente → `BadRequestException`. +7 tests en `equipment-availability.service.spec.ts`.
  - **Frontend reactivo via `ShiftService`:** `ShiftService` consume `TenantService.currentTenant()?.operationalConfig` mediante `computed()`. La regla es inquebrantable: si `hasNightShift()===false`, `currentShift()` retorna siempre `'DAY'` sin evaluar el reloj. Los componentes `AvailabilityFormComponent`, `AvailabilityMonitorComponent` y `AvailabilityImportComponent` envuelven sus selectores con `@if (shiftService.hasNightShift()) { … }`. `ShiftBadgeComponent` oculta el ícono de luna y muestra chip «Único» cuando corresponde.
- **Consecuencias:** Sin cambios de schema aditivos para tenants existentes. La configuración operativa viaja en `GET /tenant-config` (payload `operationalConfig`) que ya se llama al iniciar sesión; no se engrosa el JWT. Suite dominio backend: **383 tests · 22 suites · 0 fallos**. Suite frontend: **176 tests · 0 fallos**.

## 2026-06-03 — Sprint 3 Sistema Integrado: lifecycle cost en modal (2.2) + stock en form de OT (2.3)

- **Contexto:** Prioridades 2.2 y 2.3 del roadmap [`sistema-integrado-roadmap.md`](sistema-integrado-roadmap.md). El modal de equipo no mostraba el costo acumulado del activo (los `AssetCostRecord` existían pero solo aparecían mal etiquetados en el timeline), y el form de OT no daba visibilidad del stock disponible al agregar repuestos.
- **Decisión:**
  - **2.2 — Tab «Costos» (frontend, sin backend):** `AssetCostType` FE alineado al enum real (`PURCHASE | WORK_ORDER | LUBE_DISPATCH`); `AssetCostRecord` suma `workOrder?.correlative`. Nuevos `computed`: `costTotal`, `costByType` (subtotal + % por tipo, orden desc), `costRecordsSorted`; helper `assetCostTypeMeta` (label + color de barra/texto) y `formatMoney` reutilizado. El tab muestra KPI total + barras por tipo + tabla de imputaciones con origen (OT/OC/recepción). **Fix colateral:** el timeline del tab «Historial» etiquetaba *todos* los cost records como «Compra externa»; ahora distingue los tres tipos. +4 specs.
  - **2.3 — Stock en repuestos del form de OT (frontend, sin backend):** `stockForItem(itemId)` lee `warehouseStocks` (ya cargado al elegir bodega de consumo) y devuelve `availableQuantity` (físico − reservado). Cada línea de repuesto vinculada muestra «Stock disponible: X» (verde) o «Sin stock» (rojo); `partRowHasShortage` marca en rojo si la cantidad supera el disponible y `anyPartStockShortage` dispara un aviso en la sección. No bloquea el guardado (consistente con la regla de regularización pendiente al cerrar OT). +5 specs.
  - **Ampliación 2026-06-04:** repuestos mantienen aviso local; **fluidos M1 y OT** migraron a `app-fluid-quantity-row` con bloqueo opcional vía `blockNegativeStock` (ver decisión 2026-06-04).
- **Consecuencias:**
  - Suites: frontend **120** (+9: 4 costos + 5 stock OT); backend dominio **345** (sin cambios — Sprint 3 es 100% frontend); `ng build` y lint verdes.
  - El modal de equipo queda como **centro de lifecycle cost** (consumo + costo por tipo) y el planificador ve el abastecimiento antes de comprometer repuestos. **Sprint 3 CERRADO** → quedan solo las extensiones push de Prioridad 3 (3.1 EQUIPMENT_DOWN, 3.2 PM próxima).

## 2026-06-03 — Sprint 2 Sistema Integrado: Consumos unificados (lubricantes + repuestos) en modal de equipo

- **Contexto:** Prioridad 2.1 del roadmap [`sistema-integrado-roadmap.md`](sistema-integrado-roadmap.md). El tab «Consumos» del `equipment-detail-modal` solo mostraba lubricantes (M1); los repuestos despachados a OTs no eran visibles en la ficha del activo, rompiendo la vista de «consumo del activo». La relación `WorkOrderPart` (con `unitCost` CPP, `partNumber`, `quantity`, `inventoryItemId`) ya existía pero `getAnalytics` no la incluía.
- **Decisión:**
  - **Backend (`equipments.service.ts` `getAnalytics`):** se agregó `include: { parts: { select: ... } }` a la query de `workOrders` (últimas 50 OT CERRADAS). Cambio aditivo y mínimo — **sin endpoint nuevo** (regla del roadmap: el modal ya carga analytics al abrir). +1 spec en `equipments.service.spec.ts` (verifica el `include` y el passthrough de `parts`).
  - **Frontend types (`types.ts`):** `WorkOrderPart` ahora expone `unitCost?: number | null` e `inventoryItemId?: string | null`.
  - **Modal (`equipment-detail-modal`):** `computed partsConsumed` aplana `analytics.workOrders[].parts` en filas `{ otId, otCorrelative, date, partNumber, description, quantity, unitCost, lineCost }` (orden por fecha desc); `computed partsTotalCost` suma solo líneas con costo conocido; helper `formatMoney` (CLP). El tab «Consumos» se reestructuró en **dos secciones** (Lubricantes + Repuestos usados en OTs); cada repuesto linkea al `WorkOrderDetailModal` embebido reusando `openOtDetail` del Sprint 1. **Decisión de UX confirmada con el usuario:** dos secciones (no tabla cronológica unificada) y fuente analytics (no endpoint dedicado). +3 specs frontend.
- **Consecuencias:**
  - Suites: frontend **111** (+3), backend dominio **345** (+1); `ng build` y lint verdes.
  - El activo pasa a tener trazabilidad de consumo real: lubricantes (M1) + repuestos/costo de OTs en un solo lugar, con navegación a la OT origen.
  - Limitación conocida: los repuestos provienen de las **últimas 50 OT cerradas** (mismo alcance que el resto de analytics); si se requiere histórico completo o agrupación por período → endpoint dedicado (Sprint futuro).

## 2026-06-03 — Sprint 1 Sistema Integrado: Dashboard KPIs + indicador de Turno + tab OTs

- **Contexto:** Tras la integración transversal M1·M2·M3↔Flota, el roadmap [`sistema-integrado-roadmap.md`](sistema-integrado-roadmap.md) priorizó cerrar conexiones visibles de alto impacto (Prioridad 1.1 y 1.2). Faltaban dos métricas de salud de flota (equipos fuera de servicio reales y fallas de terreno sin OT) que no existían en `GET /work-orders/stats`, y el modal de equipo no permitía ver OTs activas (solo el timeline con cerradas).
- **Decisión:**
  - **Backend:** `getStats()` (`work-orders.service.ts`) sumó dos counts al `Promise.all`: `equiposDetenidos` (`Equipment.isOperational=false` con scope tenant/contrato) y `faultReportsOpen` (`FaultReport.status='OPEN'` por equipo accesible). +2 specs en `work-orders.service.spec.ts` (suite dominio 344).
  - **Turno activo:** nuevo `ShiftService` (`core/services/shift/`) autodetecta DÍA (08:00–20:00) / NOCHE por hora local con tick de 1 min vía `toSignal(interval)`. `ShiftBadgeComponent` (`core/components/shift-badge/`) muestra turno + reloj en `.app-shell-header` (oculto en móvil, fondo opaco sin blur por regla §5.1). Si se requiere config manual de rangos → crear módulo dedicado; `ShiftService` es el único punto a tocar.
  - **Dashboard:** 3 tiles nuevos clicables (Equipos detenidos→`/app/flota`, Fallas sin OT→`/app/operaciones/fallas`, Sin reporte de turno→`/app/operaciones/disponibilidad/monitor`); franja a `lg:grid-cols-4` (8 tiles en 2 filas). `loadUnreported()` hace una 2ª llamada no crítica a `/equipment-availability/unreported` con la fecha/turno de `ShiftService`. `DashboardUiModel` ahora exige `equiposDetenidos`, `faultReportsOpen`, `unreportedCount`.
  - **Modal de equipo:** nueva pestaña «Órdenes de Trabajo» (`TabId += 'ots'`) con carga perezosa vía `getWorkOrdersFiltered({ equipmentId, limit:20 })` — tabla con TODOS los estados (no solo cerradas como el timeline). Click en correlativo abre `WorkOrderDetailModalComponent` **embebido** (`showOtDetail`/`selectedOtId`), preservando el contexto del equipo. +5 specs.
  - **Banner de fallas OPEN en form de OT (Prioridad 1.3):** al seleccionar equipo en `work-order-form`, señal `openFaults` consulta `getReports({ equipmentId, status:'OPEN', pageSize:5 })`. Si hay fallas abiertas, banner ámbar (`warning`) con conteo + correlativos (badge criticidad vía `CRITICALITY_META`, sistema vía `SYSTEM_LABELS`, fecha) y link a `/app/operaciones/fallas`; se limpia al deseleccionar. Cierra el círculo M3 → planificación de OT. Spec nuevo `work-order-form.component.spec.ts` (4 tests; sin render de template por tamaño del componente, se invoca `ngOnInit()` y se prueba la lógica).
- **Consecuencias:**
  - Suites: frontend **108** (+9 en el sprint: +5 OTs tab, +4 banner OT), backend dominio **344** (+2); `ng build` y lint verdes.
  - El dashboard pasa a cruzar M3/Flota (detenidos), M3 (fallas OPEN) y M2 (sin reporte de turno) en un golpe de vista.
  - **Sprint 1 CERRADO**: Prioridad 1.1 (parcial — tiles base), 1.2 y 1.3 entregadas. Siguiente: Sprint 2 del roadmap.

## 2026-06-03 — Integración Transversal de Operaciones (M1·M2·M3 ↔ Flota) — INTEGRACIÓN COMPLETA

- **Contexto:** M1 (Lubricantes), M2 (Disponibilidad) y M3 (Fallas) quedaron al 100% en backend pero operaban como silos en la UI. Las acciones en terreno no se reflejaban en el Maestro de Flota ni en el modal de detalle de equipo, rompiendo la noción de fuente única de verdad (SSOT) sobre `Equipment`.

- **Decisión (Fase 1 — Documentación):**
  1. **SSOT formalizada** en `MASTER-CONTEXT.md` §2.4 «Ecosistema de Operaciones y Flota»: tablas de alimentación de `currentMeter` (4 fuentes × `MeterLogSource`) y control de `isOperational` (quién lo escribe vs. quién solo lo lee). Diagramas Mermaid. Actualizado §1.2 con referencia cruzada.
  2. **Glosario ampliado** (`glosario.md`): 7 nuevos términos — `currentMeter`, `isOperational`, Disponibilidad (M2), `OperationalStatus`, Falla/M3, Falla Crítica/ALTA, M1/M2/M3.

- **Decisión (Fase 2 — Refactor UI):**
  3. **Maestro de Flota — alerta visual crítica:** Filas con `isOperational === false` reciben borde rojo grueso + fondo rojizo + badge `animate-pulse` «FUERA DE SERVICIO». El `currentMeter` ya se mostraba en la columna «Medidor».
  4. **`FleetService` — mecanismo de frescura:** Signal `_listVersion` (readonly) + `invalidateCache()` + `refetch()`. `getEquipments` acepta `noCache:true` que agrega `_ts=Date.now()` como cache-bust HTTP.
  5. **`FleetMasterComponent` — doble garantía anti-stale:** `ngOnInit` hace refetch con cache-bust (el componente se recrea en cada navegación de ruta); `effect()` reactivo escucha `listVersion()` para invalidaciones push desde otras rutas.
  6. **`EquipmentDetailModalComponent` — Centro de Mando Operacional:** Dos nuevas pestañas con fetch perezoso (carga al abrir la pestaña, no repite si el equipo no cambia):
     - **«Salud y Operación»**: `forkJoin(faultService.getReports({pageSize:1}), availabilityService.getAll({pageSize:1}))` con `catchError`. Badge gigante real de `isOperational` (antes estaba hardcodeado a «OPERATIVO»). Tarjeta Última Falla (M3) y Último Reporte de Turno (M2).
     - **«Consumos»**: `lubeService.getReports({pageSize:5})`. Mini-tabla con folio, fecha, bodega, líneas y medidor.
  7. **Fix tipo `MeterLogSource`** en `types.ts`: añadidos `'AVAILABILITY_REPORT' | 'FAULT_REPORT'` (faltaban y causaban error TS en compilación). Etiquetas legibles añadidas al historial de medidores.

- **Decisión (Fase 3 — Invalidación push desde M3):**
  8. **`FaultReportFormComponent.onSubmitSuccess`** llama `fleetService.invalidateCache()` cuando la criticidad es `HIGH` o `MEDIUM`. `HIGH` muta `isOperational=false` en la transacción del backend; `MEDIUM` puede avanzar el horómetro. La señal `listVersion` cambia y el `effect()` del Maestro de Flota dispara la recarga aunque el componente ya esté activo. `FleetService` ya estaba inyectado en el formulario; solo se activó la llamada.

- **Consecuencias:**
  - Build Angular: `exit 0` — *Application bundle generation complete*. Sin cambios de schema, backend ni migraciones.
  - `FleetMasterComponent` y `EquipmentDetailModalComponent` son el **Centro de Mando Operacional** del EAM: consumen M1, M2 y M3 reactivamente sin acoplamiento directo entre módulos de Operaciones.
  - Doble garantía de frescura: refetch en entrada a ruta **+** invalidación push desde el formulario de fallas.
  - El ecosistema M1·M2·M3 está **100% integrado en la UI**.

## 2026-06-02 — Módulo 3: Registro de Fallas (FaultReport) — Persistencia y Seguridad

- **Contexto**: Requerimiento de capturar eventos correctivos imprevistos en terreno, actualizando el estado del equipo y alimentando la cola de trabajo del planificador. El sistema debe discriminar por criticidad para decidir el impacto automático sobre disponibilidad y mantenimiento.
- **Decisión**:
  1. **Persistencia:** Nuevo modelo `FaultReport` con enums `AffectedSystem` (7 sistemas: MOTOR, HYDRAULIC, ELECTRICAL, POWER_TRAIN, STRUCTURE, GET_WEAR, TIRES_TRACKS), `FaultCriticality` (HIGH/MEDIUM/LOW) y `FaultReportStatus` (OPEN/LINKED/CLOSED). Correlativo `RF-XXXXX` vía `SequenceCounter` existente. FK `workOrderId @unique` para relación 1:1 con la OT generada. Nuevo valor `FAULT_REPORT` en enum `MeterLogSource`.
  2. **Regla de integración con OT (forma nativa BaseLogic):** Se descartó crear tablas intermedias (`WorkRequest`, `MaintenanceBacklog`). La primitiva nativa del planificador es la `WorkOrder`. La lógica de despacho por criticidad es: **ALTA** → crea `WorkOrder(category=NO_PROGRAMADA_REACTIVA, affectsAvailability=SI, detentionStartedAt=eventDate)` + `Equipment.isOperational = false` en la misma `$transaction`; **MEDIA** → crea `WorkOrder(category=NO_PROGRAMADA_CORRECTIVA, affectsAvailability=NO)` sin impacto en disponibilidad; **BAJA** → solo registra el `FaultReport` (el planificador convierte manualmente vía `POST /fault-reports/:id/create-work-order`).
  3. **Integración con Módulo 2 (Disponibilidad):** `Equipment.isOperational = false` es mutado directamente en la transacción de una falla ALTA. `EquipmentAvailability` (Módulo 2) es declarativo/supervisor; lee `isOperational` como señal pero no es sincronizado automáticamente. El supervisor confirma el estado en su reporte de turno. Las dos capas son ortogonales.
  4. **Horómetro:** Si `meterAtFault > equipment.currentMeter`, se llama a `applyCurrentMeterChange(tx, { source: FAULT_REPORT })` dentro de la misma transacción atómica.
  5. **PBAC:** 3 nuevos permisos: `operations:fault-report:read` (ver listados), `create` (operador en terreno, genera OT automática para ALTA/MEDIA), `manage` (planificador: cierra BAJA o convierte a OT manualmente).
- **Consecuencias**: Schema: +3 enums, +1 valor en `MeterLogSource`, +1 tabla `fault_reports` con `@@unique([tenantId, correlative])` y `@unique work_order_id`. Relaciones inversas en `Equipment`, `WorkOrder`, `Tenant`, `Contract` y `User`. Migración `20260602020000_init_fault_reports_module` aplicada. Pendiente: Fase 2 (servicio, controller, DTOs) y Fase 3 (frontend Angular 18).

## 2026-06-02 — Módulo de Disponibilidad Operativa Diaria: cierre frontend + smoke tests

- **Contexto:** Cierre del módulo completo (backend + frontend) para merge a `develop`. El módulo permite a supervisores reportar el estado operativo de equipos por turno y a admins monitorear equipos sin reporte.
- **Decisión:** UX optimizada para uso en terreno (lectura al sol): búsqueda de equipos en memoria con Signals (sin debounce ni HTTP extra), bloqueo de fechas futuras en `reportDate`, feedback de colores semánticos por `OperationalStatus` en el formulario. Separación de permisos `CREATE` (supervisor reporta) vs `MONITOR` (admin/jefe consulta omisiones). Smoke tests con Jasmine + Angular `TestBed`: 12 tests para `AvailabilityFormComponent` (estado inicial, `isFormValid`, `isDirty`, `confirmLeaveIfDirty`, `resetForm`) y 13 tests para `AvailabilityMonitorComponent` (empty state verde, alerta con equipos pendientes, `allReported`, `unreportedCount`, `onShiftChange`, `onDateChange`).
- **Consecuencias:** Suite frontend: 25/25 specs en verde (sin romper ningún otro test). Suite backend: 342 tests · 19 suites · 0 fallos. Módulo listo para merge `develop → main` post-QA.

## 2026-06-02 — Módulo de Disponibilidad Operativa Diaria: persistencia y lógica de omisiones

- **Contexto**: Requerimiento de registrar el estado de cada equipo por turno (Día/Noche) y alertar al administrador qué equipos no han sido informados en el turno activo. El módulo debe cruzar el Maestro de Flota con los registros del turno sin introducir campos derivados en la base de datos.
- **Decisión (1 — sin `isAvailable` persistido)**: Se descartó agregar un campo booleano `isAvailable` a `EquipmentAvailability` o a `Equipment`. Prisma no soporta columnas generadas (`GENERATED ALWAYS AS`) de forma nativa; mantener el booleano sincronizado en el código introduciría una superficie de bugs y acoplaría la lógica de negocio ("¿es STANDBY disponible?") al schema de base de datos, dificultando cambios futuros de la regla sin nueva migración. La derivación se hace en la capa de servicio con una función pura (`isAvailableStatus(s: OperationalStatus): boolean`) exportada desde `availability.helpers.ts`. Para KPIs de uptime a escala se usará `$queryRaw` con `COUNT(*) FILTER (WHERE status IN (...))` o una vista Postgres materializable, sin columnas extras en la tabla.
- **Decisión (2 — cruce en memoria para equipos no informados)**: El endpoint `GET /api/equipment-availability/unreported` usa la estrategia `Promise.all` + `Set` (dos queries Prisma en paralelo, diff en Node.js) en lugar de un `$queryRaw` con `NOT IN`. Razón: para flotas de EAM industrial (< 300 equipos activos por contrato) el overhead de dos queries paralelas es subms y el código es idiomático, testeable y libre de SQL crudo. El filtro `isOperational: true` excluye equipos ya marcados fuera de servicio por OT activa, evitando falsos positivos de omisión. Si en el futuro la flota supera los 1000 equipos por contrato, se reemplaza la implementación por `$queryRaw` con `NOT IN` usando los índices `(tenant_id, report_date, shift)` y `(tenant_id, contract_id)` ya creados en la migración, sin cambiar la firma del endpoint.
- **Consecuencias**: Schema con 2 nuevos enums (`ShiftType`, `OperationalStatus`), 1 valor nuevo en `MeterLogSource` (`AVAILABILITY_REPORT`), tabla `equipment_availabilities` con `@@unique([tenantId, equipmentId, reportDate, shift])`. 3 nuevos permisos PBAC: `operations:availability:read/create/monitor`. Horómetro actualizado vía `applyCurrentMeterChange` solo si `meterReading > equipment.currentMeter` (guard en el servicio, no en el helper). Fase 2 pendiente: servicio, controller, DTOs y frontend Angular 18.

## 2026-06-02 — Módulo de Consumo de Lubricantes (Integración Flota/Kardex)

- **Contexto**: Necesidad de trazar el despacho en terreno de aceites/grasas asociando el costo directo al equipo y controlando el Kardex de forma inmutable.
- **Decisión**: Se implementó una arquitectura en 3 capas. 1) Bodegas Móviles (`Warehouse type=VIRTUAL`) como origen de suministro (camión lubricador). 2) Transacción atómica `Prisma.$transaction(Serializable)` que rebaja stock (`InventoryTransaction type=OUT, referenceType=LUBE_DISPATCH`) usando el CPP congelado al momento del despacho, actualiza el horómetro del equipo vía `applyCurrentMeterChange` e imputa el costo en `AssetCostRecord (LUBE_DISPATCH)`. 3) Frontend Angular 18 standalone usando Signals, servicio HTTP tipado y `GlobalItemPicker` filtrado por familia "Lubricantes" (`lockedFamilyId`). Correlativo `RCL-XXXXX` generado por `SequenceService`. Protección PBAC con `operations:lube-report:read/create`.
- **Consecuencias**: El sistema cruza automáticamente Operaciones (Flota/Horómetros) con Inventario (stock W2W, Kardex inmutable) y Finanzas (imputación de costo directo al activo). Se añadieron los permisos `OPERATIONS_LUBE_REPORT_READ` y `OPERATIONS_LUBE_REPORT_CREATE` (backend `permissions.enum.ts` + frontend `operations-permissions.ts`). Nuevos modelos Prisma: `LubeReport`, `LubeReportLine`; nuevo valor enum `AssetCostType.LUBE_DISPATCH`. Suite de 8 tests unitarios en `lube-reports.service.spec.ts` sin DB real (`jest-mock-extended`).

## 2026-05-24 — Compras PBAC: simulador API + E2E Playwright

- **Contexto:** Tras Fase 3 PBAC faltaba verificación automatizada end-to-end del módulo P2P (43 permisos `purchases:*`, ACL firmas, menú UI).
- **Decisión:** Seed `seed-compras-pbac-personas.ts` (13 personas); script `simulate-compras-pbac.mjs` con matriz 43 probes, flujos A–J y cobertura K–S; paquete `e2e/` con Playwright (5 smoke UI). Doc: [`compras-pbac-pruebas-api-e2e.md`](compras-pbac-pruebas-api-e2e.md).
- **Consecuencias:** QA en `develop` puede correr `simulate:compras-pbac -- --all` y `e2e` tras seed. No incluir `.xlsx` de inventario en commits. Throttle login: `PBAC_LOGIN_DELAY_MS=3500` si 429.

## 2026-05-24 — PBAC Fase 3: erradicación enum `MECHANIC` / `SUPERVISOR`

- **Contexto:** Fase 2 migró lógica a permisos; el enum y la UI aún exponían roles legacy. Pre-producción sin deuda masiva de datos.
- **Decisión:** `UserRole` = `SUPER_ADMIN` | `ADMIN` | `USER` únicamente. Migración `20260524120000_remove_legacy_roles` (UPDATE a `USER` antes de alterar enum). Espejos tenant por defecto: `Sistema · ADMIN` y `Sistema · USER`; `ensureSuperAdminMirrorRole` en seed. `findAssignableForOt` solo por permisos OT en JSON.
- **Consecuencias:** Re-login tras deploy. Usuarios legacy quedan `USER` — reasignar `TenantRole` PBAC. Suite dominio **282 tests**. Ver [pbac-matriz-verificacion.md](pbac-matriz-verificacion.md).

## 2026-05-24 — Migración W2W: ALTER condicional (orden vs tablas futuras)

- **Contexto:** `20260414170504` hacía `ALTER TABLE unit_of_measures` antes de que existiera la tabla (`20260417100000`); QA en bucle P3018.
- **Decisión:** ALTER/índices de `item_categories`, `unit_of_measures`, `warehouse_bins` solo si la tabla/columna existe; script `prisma-migration-checksum.mjs` para prod si cambia checksum.
- **Consecuencias:** QA: redeploy backend o borrar `pgdata-qa`. Prod ya migrado: actualizar checksum en `_prisma_migrations` tras deploy.

## 2026-05-24 — Dominios QA: `qa.baselogic.cl` + `qa-api.baselogic.cl`

- **Contexto:** `qa.app.*` / `qa.api.*` no entran en el wildcard gratuito `*.baselogic.cl` de Cloudflare (dos niveles).
- **Decisión:** Front `https://qa.baselogic.cl`, API `https://qa-api.baselogic.cl`; plantilla `deploy/qa.env.example` y [coolify-qa-setup.md](coolify-qa-setup.md) actualizados.
- **Consecuencias:** Tras cambio DNS, actualizar variables Coolify y **rebuild** frontend (`QA_API_URL`, `FRONTEND_URL`).

## 2026-05-22 — Stack Coolify QA (`docker-compose.qa.yml`)

- **Decisión:** Compose QA, `environment.qa.ts` + build args en `frontend/Dockerfile`, plantilla `deploy/qa.env.example`, guía [coolify-qa-setup.md](coolify-qa-setup.md).
- **Consecuencias:** Coolify puede desplegar rama `develop` con dominios QA aislados; usuario completa DNS + variables en panel.

## 2026-05-22 — Smoke Jest + CI GitHub + rama `develop` (QA)

- **Decisión:** `backend/test/jest-setup.ts` (mock `file-type`); specs smoke con deps/guards; workflow `.github/workflows/backend-tests.yml` (`test:domain` + `npm test` en `main`/`develop`); rama remota **`develop`** para staging.
- **Consecuencias:** Suite completa **220 tests** verde. Pendiente usuario: subdominio QA + segunda app Coolify (checklist §4 en `entornos-git-despliegue.md`).

## 2026-05-22 — Suite N+18: recordPayment/remove facturas + promoteBacklogItem OT

- **Decisión:** `purchase-invoices` +5 (`recordPayment`, `remove`); `promoteBacklogItem` +3 (`TO_TASK`, `TO_NEW_OT`).
- **Consecuencias:** Suite dominio **280 tests**.

## 2026-05-22 — Suite N+17: IN_PROGRESS OT + update/markPaid facturas

- **Decisión:** `work-orders` +4 (`IN_PROGRESS`, disponibilidad equipo); `purchase-invoices` +5 (`update`, `markPaid`).
- **Consecuencias:** Suite dominio **272 tests**.

## 2026-05-22 — Suite N+16: downtime OT + factura parcial 3-way + OC elegibles recepción

- **Decisión:** OT +3 (fechas invertidas, `cumulativeDowntimeHours`); `purchase-invoices.create` +3 (encadena 3-way en `PARTIALLY_RECEIVED`); `findEligibleForWarehouseReceipt` +2; mock `purchase-contract-access` con `requireActual` en specs OC.
- **Consecuencias:** Suite dominio **263 tests**.

## 2026-05-22 — Suite N+15: validaciones cierre OT + costo equipo en recepción

- **Decisión:** `work-orders` +4 (detención, atención mecánica, operativo, `assetCostRecord`); `warehouse-receipts.confirm` +1 (imputación `PURCHASE` con `equipmentId`).
- **Consecuencias:** Suite dominio **255 tests** (OT 12, recepción 19).

## 2026-05-22 — Suite N+14: OT fluidos/medidor/garantía + recepción multi-línea

- **Decisión:** `work-orders.service.spec` +5 (fluidos, medidor, `applyCurrentMeterChange`, correo `POSIBLE_GARANTIA`); `warehouse-receipts.confirm` +1 (mix inventario/gasto directo).
- **Consecuencias:** Suite dominio **250 tests** (OT 8, recepción 18).

## 2026-05-22 — Suite N+13: cierre OT con stock + revoca overrule 3-way

- **Decisión:** Nuevo `work-orders.service.spec` (3, cierre CLOSED); `validateInvoiceMatch` revoca overrule si `!matchReceived`; `test:domain` con 13 suites.
- **Consecuencias:** Suite dominio **244 tests**.

## 2026-05-22 — Suite N+12: recepción confirm + 3-way facturas

- **Decisión:** `warehouse-receipts` +3 (`confirm` sobre-recepción, bodega inactiva, gasto directo); `purchase-invoices` +4 (tolerancia, NC neto, overrule ACL y tope recepción).
- **Consecuencias:** Suite dominio **240 tests** (recepción 17, facturas 16 en spec).

## 2026-05-22 — Suite N+11: resetToDraft, edición OC post-envío, W2W recepción

- **Decisión:** `purchase-orders` +3; `inventory-transfer` +4 (validaciones execute/confirm + política destino).
- **Consecuencias:** Suite dominio **233 tests**. `updateSensitiveFields` no valida recepciones (solo estados); anulación sí (`cancel`).

## 2026-05-22 — Suite N+10: OC parcial, SRC delete línea, performReturn sin stock

- **Decisión:** `purchase-orders` +4 (reject vs recepción parcial, cancel sin guías, forceClose audit); `purchase-requisitions` +1 (delete línea); `inventory-stock` +1 (política en primera devolución).
- **Consecuencias:** Suite dominio **227 tests**.

## 2026-05-22 — Suite N+9: SRC post-adjudicación + update sin política bodega

- **Decisión:** `purchase-requisitions` +3 (`PENDING_APPROVAL` permisos/cantidad; `PARTIALLY_PURCHASED` línea nueva); `inventory-items` +1 (DTO `update` omite `warehouseId`/min-max).
- **Consecuencias:** Suite dominio **222 tests**. Política de stock en alta sigue solo en `create`/`quickCreate`.

## 2026-05-22 — Suite N+8: SRC `update` SUBMITTED + `InventoryItemsService.update`

- **Decisión:** `purchase-requisitions` +2 (`update` SUBMITTED OT/equipo, forbidden vínculos); `inventory-items` +4 (`update`: código fijo, PN, nombre, lookup `IN####`). UUIDs de fixture en formato v4 válido (`UUID_PARAM_RE`).
- **Consecuencias:** Suite dominio **218 tests**. Siguiente N+9: edición SRC post-adjudicación, política bodega en update.

## 2026-05-22 — Suite N+7: SRC `update` + `quickCreate` catálogo

- **Decisión:** `purchase-requisitions` +5 (`update`: permisos QUOTING/SUBMITTED/DRAFT, líneas, cotización); `inventory-items` +4 (`quickCreate`: validaciones, política bodega, PN duplicado).
- **Consecuencias:** Suite dominio **212 tests** (inventario 93 + compras 119). Pendiente commit/push; siguiente N+8: `update` SUBMITTED happy path, `InventoryItemsService.update`.

## 2026-05-22 — Suite N+6: SRC create/duplicate/selectQuotation + catálogo

- **Decisión:** `purchase-requisitions` +7 (`create`, `duplicate`, `selectQuotation`); `inventory-items` +7 (`search`, `create`, `remove`).
- **Consecuencias:** Suite dominio **203 tests**. Siguiente: `update` SRC, `quickCreate` artículo, cobertura CI opcional.

## 2026-05-22 — Documentación y reglas maestras de testing + scripts `test:domain`

- **Contexto:** Suite de dominio ~212 tests; reglas del usuario (BaseLogic EAM) y necesidad de que agentes ejecuten Jest al editar sin depender de PostgreSQL.
- **Decisión:** Índice [`pruebas-unitarias.md`](pruebas-unitarias.md), regla Cursor `testing-baselogic.mdc`, workflow en `tpm-arquitectura.mdc` §6; scripts `npm run test:domain` y `test:domain:watch` en `backend/package.json`; doc frontend y [`entornos-git-despliegue.md`](entornos-git-despliegue.md) para QA futuro.
- **Consecuencias:** Agentes deben correr `test:domain` al cerrar cambios de dominio; `npm test` completo puede fallar en smoke de controladores (ESM `file-type`) hasta remediar.

## 2026-05-22 — Suite N+5: SRC cancel/cotizaciones, regularización inventario

- **Decisión:** `purchase-requisitions.service.spec` +13 (`cancel`, `startQuoting`, `addQuotation`, `findAll`); `inventory-stock` +4 (IRA tope, regularización pendiente).
- **Consecuencias:** Suite dominio **189 tests**. Siguiente: `selectQuotation`, `create` SRC, cobertura CI opcional.

## 2026-05-22 — Suite N+4: stock bodega, PDF conteo, SRC adjudicación/envío

- **Decisión:** Nuevo `purchase-requisitions.service.spec.ts` (7); +6 en `inventory-stock` (`getStockByWarehouse`, `buildPhysicalCountSheetPdf` con generator mockeado).
- **Consecuencias:** Suite dominio **172 tests** (12 archivos). Siguiente: `cancel`/`startQuoting` SRC, listados deuda inventario.

## 2026-05-22 — Suite N+3: IRA, findAll recepciones, SRC→OC split, push batch

- **Decisión:** +12 tests: `getInventoryRecordAccuracy` (3), `warehouse-receipts.findAll` (3), `createOrdersFromRequisition` (4), `notifyApproversForPendingSignatureBatch` (2).
- **Consecuencias:** Suite dominio **159 tests**. Mock `purchase-quotation-status-sync.util`; `purchase-contract-access.util` con `requireActual` en spec recepciones para `buildPurchaseContractScopeFilter`.

## 2026-05-22 — Suite N+2: génesis ledger, recepción create/update, alertas, listado W2W

- **Decisión:** +15 tests: `findItemLedger` génesis (2), `warehouse-receipts` `create`/`updateItems` (7), `getSupplyAlerts` (2), `listTransfers`/`getTransferById` (4).
- **Consecuencias:** Suite dominio **147 tests**. Siguiente: `getInventoryRecordAccuracy`, `createFromRequisition`, listado recepciones.

## 2026-05-22 — Suite ledger + recepción: findItemLedger, confirm, trace

- **Contexto:** Roadmap §0 en `pruebas-unitarias-backend.md` apuntaba a kardex por artículo, confirmación de guías y trazabilidad en listado por bodega.
- **Decisión:** Tres ampliaciones: `inventory-items.service.spec.ts` (5, `findItemLedger`), `warehouse-receipts.service.spec.ts` (4, `confirm` con delta `quantityConfirmed`), +2 tests en `inventory-stock` (`enrichTransactionsTrace` vía `getTransactionsByWarehouse`).
- **Consecuencias:** Suite dominio crítico **132 tests** (inventario 54 + compras 78). Siguiente: génesis en ledger, `updateItems` recepción, `getSupplyAlerts`, `listTransfers`.

## 2026-05-22 — Suite unitaria backend: inventario stock + jest-mock-extended

- **Contexto:** Kardex y movimientos (`InventoryStockService`) son críticos; no había specs de negocio ni convención documentada para mocks Prisma.
- **Decisión:** Añadir `inventory-stock.service.spec.ts` (23 tests) con `mockDeep<PrismaService>()`; instalar `jest-mock-extended` con `--legacy-peer-deps` (Jest 30). Mantener inventario vivo en `docs/agentes/pruebas-unitarias-backend.md`.
- **Consecuencias:** Siguiente bloque de tests planificado en compras: `approve`, `upsertPolicies`, `resolveApprovalPolicyForUser`. Los specs smoke existentes (auth, users, sites) no sustituyen cobertura de dominio.

## 2026-05-22 — Suite unitaria compras: ACL, matriz y `approve`

- **Contexto:** Gobernanza de OC (usuarios explícitos por nivel, `minAmount`, orden de firmas) documentada en `PURCHASE-GOVERNANCE.md` sin tests automatizados.
- **Decisión:** Tres specs: `tenant-role-defaults.spec.ts` (5), `purchase-settings.service.spec.ts` (6), `purchase-orders.service.spec.ts` — bloque `approve` (11). Mock de `assertUserHasContractAccess`. Inventario actualizado en `pruebas-unitarias-backend.md` §4.
- **Consecuencias:** Suite dominio crítico ampliada a 62 tests (+ `reject`, `getSettings`/`updateSettings`, `signature.util`, `validateInvoiceMatch`). Ver `pruebas-unitarias-backend.md` §4.5–4.6. Pendiente: `cancel` OC, `overruleThreeWayMatch`.

## 2026-05-22 — Suite compras: cancel, envío proveedor, overrule 3-way

- **Contexto:** Pendientes de `pruebas-unitarias-backend.md` tras bloque ACL/`approve`.
- **Decisión:** Ampliar `purchase-orders.service.spec` (`cancel`, `markAsSentToSupplier`) y `purchase-invoices.service.spec` (`overruleThreeWayMatch`). Suite dominio = **76 tests**.
- **Consecuencias:** Documentado en §4.4–4.6. Pendiente: notas de crédito 3-way, push post-firma, `resetToDraft`.

## 2026-05-22 — Suite compras: NC, resetToDraft, forceClose, push

- **Decisión:** `purchase-credit-notes.service.spec.ts` (8), ampliación `purchase-orders` (+6: reset, forceClose, notificación). Suite dominio **91 tests**. Roadmap §0 en `pruebas-unitarias-backend.md`.
- **Siguiente paso:** `InventoryTransferService` + `InventoryAdjustmentService` (ver §0 doc pruebas).

## 2026-05-22 — Pruebas `InventoryTransferService` (W2W)

- **Decisión:** `inventory-transfer.service.spec.ts` (12): `executeTransfer` (OUT, stock origen, UoM entera) y `confirmReception` (CPP ponderado destino, TRANSFER_IN, política nueva fila).
- **Siguiente paso:** `InventoryAdjustmentService` (ver §0 `pruebas-unitarias-backend.md`). Suite dominio: **103 tests**.

## 2026-05-22 — Pruebas `InventoryAdjustmentService` (saldo pendiente)

- **Decisión:** `inventory-adjustment.service.spec.ts` (12): `CONTEO` vía `performTransaction`; `SALDO_PENDIENTE` en transacción Serializable con sync `receiptItem` / `warehouseReceipt` / `purchaseOrder`.
- **Siguiente paso:** `PurchaseOrdersService.updateSensitiveFields`. Suite dominio: **115 tests**.

## 2026-05-22 — Pruebas `updateSensitiveFields` (OC)

- **Decisión:** +6 tests en `purchase-orders.service.spec.ts`: limpieza de firmas, umbral 2/3, líneas, push al reabrir firma.
- **Siguiente paso:** `InventoryItemsService.findItemLedger`. Suite dominio: **121 tests**.

## 2026-05-19 — Recepciones parciales persistentes con delta de stock

- **Contexto:** El módulo de recepciones creaba una nueva guía por cada recepción parcial, forzando al usuario a volver al listado "Nueva recepción" para continuar. Además el historial de eventos era genérico y usaba "ítem(s)".
- **Decisión:** Una guía de recepción (`WarehouseReceipt`) permanece editable mientras su estado sea `PENDING` o `PARTIAL`; solo `COMPLETED` es de solo lectura. Se agrega el campo `quantityConfirmed` a `ReceiptItem` para trackear el delta ya movido a stock. Cada llamada a `confirm()` solo mueve `quantityReceived − quantityConfirmed` al kardex, evitando doble conteo.
- **Consecuencias:**
  - Migration `20260519000000_receipt_item_quantity_confirmed` agrega la columna con backfill de registros existentes.
  - `forceClose` de OC también cierra guías PENDING/PARTIAL asociadas.
  - Frontend en modo PARTIAL muestra "Agregar ahora" (delta=0 inicial) y el tope es `quantityExpected − quantityConfirmed`. El botón "Guardar avance" fue eliminado; solo existe "Confirmar Recepción" (verde para completa, ámbar para parcial).
  - Historial: eventos separados `warehouse_receipt_partial` vs `warehouse_receipt_completed` con cantidades exactas por artículo.
  - Columnas de tabla fija (7 edit / 6 readonly) para evitar desalineación por columnas condicionales.

## 2026-05-19 — Alcance por contrato para rol base `USER`

- **Contexto:** Usuarios con `role: USER` + TenantRole con todos los permisos PBAC veían listados vacíos en Compras (SRC, OC, etc.) y Operaciones.
- **Decisión:** El alcance de datos no depende del enum `UserRole` salvo bypass `ADMIN` / `SUPER_ADMIN`. Cualquier otro rol usa `allowedContracts` del JWT (filas `UserContract`). Util compartido `backend/src/common/contract-scope.util.ts`. En admin de usuarios, la UI de “Contratos permitidos” aplica también a `baseRole === USER`.
- **Consecuencias:** Sin contratos asignados el listado sigue vacío (sentinel UUID). Tras asignar contratos, el usuario debe **volver a iniciar sesión** para refrescar el JWT. No se concede tenant-wide solo por tener permisos PBAC.

## 2026-05-19 — Indicador visual de qty y modal de ficha de artículo

- **Contexto:** Usuario quería feedback inmediato al ingresar cantidades y poder consultar el catálogo sin salir de la vista.
- **Decisión:** Columna "Estado" con badge coloreado por fila (`sin ingresar`, `parcial: X de Y`, `✓ completo`). Click en nombre del artículo abre un modal con datos del catálogo y tabla de cantidades en contexto.
- **Consecuencias:** Clases CSS con `/` (Tailwind) no se pueden usar en `[class.xxx]` de Angular; se definieron `.row-qty-complete` / `.row-qty-partial` en `styles.scss` y se usa `[ngClass]`.

## 2026-06-03 - Sprint 4 Sistema Integrado: EQUIPMENT_DOWN push + correo (3.1)

- **Contexto:** Sprint 4 del roadmap de integracion transversal. Los Sprints 1-3 implementaron UI cruzada; Sprint 4 cierra el ciclo con notificaciones salientes cuando un equipo queda fuera de servicio.
- **Decision:**
  - Nuevo evento NOTIFICATION_EVENTS.EQUIPMENT_DOWN en el catalogo.
  - FaultReportsService.create dispara (fire-and-forget, fuera de la transaccion Serializable) 
otifyEquipmentDown() cuando criticality === HIGH.
  - Pool de destinatarios: 
ole = ADMIN activos + usuarios con UserContract al contrato del equipo (misma logica de acceso que el modulo de compras).
  - Motor omnicanal NotificationDispatcherService: EMAIL (opt-in) + WEB_PUSH (opt-in) + ccEmails del tenant.
  - Plantilla uildMailEquipmentDown en 	ransactional-mail.builder.ts; preview en docs/email-previews/07-equipo-fuera-de-servicio.html.
  - Frontend: parsePushNotificationData refactorizado a PushNavAction; clic en push de EQUIPMENT_DOWN navega a /app/operaciones/fallas.
  - ault-reports.service.spec.ts sumado a 	est:domain (20 suites, 360 tests).
- **Consecuencias:**
  - Sin cambios de schema. No requiere nueva migracion.
  - Los modulos existentes (M1, M2, OT) solo actualizan isOperational=true cuando corresponde; la notificacion EQUIPMENT_DOWN es exclusiva de M3 falla ALTA.
  - Sprint 4.2 (PM proxima) pendiente de confirmacion de diseno (requiere campo anti-spam en schema).
