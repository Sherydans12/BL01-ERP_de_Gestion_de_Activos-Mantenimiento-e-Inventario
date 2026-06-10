# Notas de Liberación — Módulo de Operaciones en Terreno v1.0

**Producto:** TPM — Gestión de Activos y EAM  
**Versión del módulo:** Operations v1.0  
**Fecha de liberación:** 2026-06-04  
**Entorno objetivo:** QA (Coolify) → Producción  
**Clasificación:** Mayor · Primera liberación del módulo operativo integrado (+ hardening de integridad de fluidos)

---

## Resumen ejecutivo

Esta versión cierra el ciclo operativo completo del turno: desde el momento en que el supervisor llega a la faena y reporta el estado de la flota, pasando por el lubricador que documenta los despachos de aceite, hasta el operario que levanta una falla en terreno — **todo en la misma plataforma, conectado al mismo activo físico, en tiempo real**.

El resultado es una fuente única de verdad para el horómetro de cada equipo, un historial de intervenciones sin brechas y notificaciones automáticas cuando un equipo crítico queda fuera de servicio.

---

## Módulos incluidos en esta versión

### M1 · Consumo de Lubricantes

**¿Qué puede hacer ahora el equipo?**

El camión lubricador registra cada despacho directamente en la app: qué aceite entregó, en qué equipo, cuántos litros, y la lectura del horómetro al momento del servicio. El sistema descuenta automáticamente el stock de la bodega de origen y deja la trazabilidad en el kardex de inventario.

**Capacidades principales:**

- Registro de despacho con múltiples productos por equipo (aceite motor, hidráulico, transmisión, etc.).
- Descuento de stock en tiempo real desde la bodega virtual del camión lubricador, centralizado en `InventoryStockService.performTransactionCore` (misma lógica que OT e inventario).
- **Visibilidad de stock al elegir artículo:** badge «Disponible: X [UoM]» por línea (componente shared `app-fluid-quantity-row`); el dato proviene del picker sin consultas adicionales.
- **Control de stock negativo configurable:** en **Ajustes → Empresa**, el toggle «Bloquear stock negativo» activa rechazo estricto (`BadRequestException`) en lugar de permitir saldo pendiente de regularización.
- **Precisión decimal:** cantidades con `Decimal.js` y epsilon `1e-9`; rechazo de fracciones si la UoM del artículo no admite decimales.
- **Consumo inusual:** despachos que superan el umbral lógico (p. ej. 100 LT) exigen confirmación explícita («Confirmar cantidad inusual») antes de guardar.
- Lectura de horómetro opcional: si el operario la ingresa, el sistema actualiza el contador de horas del equipo. Si la lectura fuera menor a la última registrada, el sistema la **rechaza** con un mensaje claro — el horómetro nunca retrocede.
- Banner de referencia de lectura (Trinidad Operativa): muestra la última lectura y su fuente antes de ingresar horómetro o cantidad.
- El costo de cada despacho queda imputado al activo para el cálculo del costo de ciclo de vida.

---

### M2 · Disponibilidad Operativa Diaria

**¿Qué puede hacer ahora el equipo?**

El supervisor de turno puede confirmar el estado operativo de toda su flota en minutos, ya sea equipo por equipo o cargando un Excel preparado por el sistema.

**Capacidades principales:**

#### Registro individual por turno
El supervisor selecciona el equipo, el turno (Día / Noche), la fecha y el estado operativo (Operativo / Standby / Reserva sin Operador / Detenido por Falla / Detenido por Mantenimiento). Opcionalmente registra el horómetro al cierre del turno.

#### Carga masiva desde Excel
Descarga la planilla del día con los equipos sin reportar pre-cargados. Completa los estados en Excel (con lista desplegable validada), guarda y sube el archivo. El sistema valida fila por fila, muestra una previsualización con colores (verde / rojo) y permite confirmar en un solo clic. Los registros con error se reportan de forma individual sin bloquear los exitosos.

> **Impacto operativo:** un turno de 30 equipos, que antes requería 30 acciones manuales separadas, ahora se completa en dos pasos: descargar la plantilla y subir el Excel.

#### Seguridad del horómetro en M2
Si el supervisor ingresa una lectura menor a la actual del equipo, el sistema **no actualiza el medidor** pero sí guarda el parte de disponibilidad. La lectura errónea se descarta silenciosamente y no contamina el historial. El supervisor recibe el estado de la flota y el horómetro permanece íntegro.

---

### M3 · Registro e Informe de Fallas

**¿Qué puede hacer ahora el equipo?**

El operario o supervisor levanta un reporte de falla directamente desde el terreno, con toda la información técnica necesaria y evidencia fotográfica adjunta. El sistema actúa automáticamente según la criticidad del evento.

**Capacidades principales:**

#### Motor de reglas por criticidad

| Criticidad | ¿Qué hace el sistema? |
|:----------:|----------------------|
| **ALTA** | Registra la falla · Crea una OT correctiva reactiva · Marca el equipo como **Fuera de Servicio** · Envía notificación push y correo a supervisores y administradores |
| **MEDIA** | Registra la falla · Crea una OT correctiva sin detener el equipo |
| **BAJA** | Registra la falla en estado Abierta para que el planificador evalúe y decida si escalar |

#### Evidencia fotográfica
Hasta 3 archivos adjuntos por reporte (imágenes JPG/PNG/WEBP y video MP4, máx. 10 MB por archivo). Las fotos quedan asociadas de forma permanente al historial del equipo y al reporte de falla.

#### Escalación manual de fallas bajas
El planificador puede crear una OT desde cualquier reporte de falla en estado Abierta, sin necesidad de volver a ingresar los datos técnicos.

#### Integración con el formulario de Órdenes de Trabajo
Cuando el planificador crea una OT y selecciona un equipo con fallas Abiertas sin vincular, el sistema muestra un banner de alerta con el detalle de cada falla. Así ninguna intervención se programa sin conocer el estado real del activo.

Al **cerrar una OT**, los fluidos de inventario usan la misma fila de cantidad (`app-fluid-quantity-row`) que M1: stock visible, validación decimal, aviso o bloqueo por stock insuficiente según configuración del tenant, y confirmación de consumo inusual vía `confirmedLargeFluidDispatch`.

---

## Integridad de fluidos — stock, decimales y consumo inusual

Esta versión cierra una brecha detectada en auditoría: M1 y OT permitían stock negativo silencioso y cantidades en punto flotante sin validación unificada en UI.

### Qué cambió

| Área | Antes | Ahora |
|------|-------|-------|
| **Descuento de stock (M1 / OT)** | Lógica duplicada; negativo → `isPendingRegularization` siempre | Un solo núcleo: `performTransactionCore` con aritmética `Decimal.js` |
| **Stock negativo** | Siempre permitido con regularización pendiente | **Configurable** por tenant (`blockNegativeStock` en `TenantOperationalConfig`) |
| **UI de cantidad** | Input manual «Litros» fijo en OT; sin stock en M1 | Componente shared `app-fluid-quantity-row` en M1 y OT |
| **Decimales** | Sin validación coherente UoM | `step` 0.01 o 1; rechazo si `allowsDecimals=false` |
| **Consumo atípico** | Sin salvaguarda | Umbral por UoM + checkbox de confirmación |

### Modos de stock negativo

- **`blockNegativeStock = false` (default):** comportamiento legacy — si el despacho supera el disponible, el kardex registra saldo negativo y marca `isPendingRegularization`. La UI muestra aviso **ámbar**.
- **`blockNegativeStock = true`:** el backend rechaza la operación con mensaje explícito (*Stock insuficiente para X. Disponible: Y, solicitado: Z.*). La UI muestra error **rojo** y bloquea Guardar / Cerrar OT.

### Configuración

**Ajustes → Empresa → Operaciones:** toggle «Bloquear stock negativo» (persistido en `PATCH /tenant-config/operational` junto con la configuración de turnos).

---

## Centro de mando del equipo — Modal de detalle integrado

El modal de detalle de cada equipo en el módulo de Flota consolida toda la información de las tres fuentes en una sola pantalla con pestañas:

| Pestaña | Contenido |
|---------|-----------|
| **Información Base** | Ficha técnica, estado operativo actual, próximo PM |
| **Salud y Operación** | Última falla registrada (M3) + último parte de disponibilidad (M2) |
| **Órdenes de Trabajo** | Historial completo de OTs abiertas y cerradas, con navegación al detalle sin perder el contexto |
| **Consumos** | Últimos despachos de lubricantes (M1) + repuestos imputados en OTs cerradas |
| **Costos** | Costo de ciclo de vida acumulado con desglose por tipo (compras, lubricantes, repuestos) |
| **Historial de Medidores** | Kardex completo del horómetro (ver sección siguiente) |
| **Documentación** | Estado de vencimiento de documentos legales (SOAP, revisión técnica, permisos) |
| **Historial de actividad** | Línea de tiempo cronológica de eventos: OTs, ajustes y costos |

---

## Historial clínico del horómetro — Kardex de medidores a prueba de errores

Cada vez que el horómetro de un equipo avanza — ya sea por un parte de turno (M2), un despacho de lubricantes (M1), el reporte de una falla (M3) o el cierre de una OT — el sistema registra en forma inmutable:

- La lectura anterior y la nueva.
- La fuente que originó el cambio (Reporte de disponibilidad / Manual-Lubricante / Reporte de falla / Orden de trabajo).
- El usuario responsable.
- La fecha y hora exacta.

La pestaña **«Historial de Medidores»** muestra este kardex ordenado cronológicamente con el salto en horas entre cada registro (`+50 Hrs`, `+120 Hrs`, etc.).

### Protección contra errores humanos — Silent Skip

El sistema implementa una regla de negocio simple pero crítica: **el horómetro nunca retrocede**.

- **M1 (Lubricantes):** si el operario ingresa una lectura menor a la actual, el sistema rechaza el despacho completo y le informa. El error debe corregirse antes de continuar.
- **M2 (Disponibilidad) y M3 (Fallas):** si la lectura anotada es menor a la actual, el sistema guarda el registro operativo (el parte o la falla) pero descarta silenciosamente la lectura incorrecta. La operación no se bloquea, pero el historial de horómetros queda limpio.

> **¿Por qué importa?** El horómetro es la base para calcular cuándo corresponde la próxima mantención preventiva. Un valor incorrecto puede adelantar o retrasar una intervención crítica. Esta protección garantiza que el plan de mantenimiento se construya sobre datos reales.

---

## Notificaciones automáticas — Equipo fuera de servicio

Cuando se registra una falla de criticidad **ALTA**, el sistema:

1. Marca el equipo como Fuera de Servicio de forma inmediata.
2. Envía una **notificación push** (navegador) a todos los usuarios activos del contrato.
3. Envía un **correo electrónico** con el detalle de la falla, el equipo afectado y la OT generada automáticamente.

Los destinatarios son los administradores del tenant y todos los usuarios con acceso al contrato del equipo. El canal (push, correo o ambos) respeta la configuración de preferencias de cada usuario.

---

## Cobertura de pruebas de esta versión

Esta versión fue validada con tres niveles de pruebas automatizadas:

| Nivel | Descripción | Resultado |
|-------|-------------|-----------|
| **Unitario — Helper de horómetro** | `applyCurrentMeterChange`: happy path, silent skip, fuentes M1/M2/M3, orden de operaciones | 7/7 ✅ |
| **Unitario — Precisión de stock** | `stock-quantity.util`: resta decimal, epsilon, detección de déficit | 3/3 ✅ |
| **Integración — Caos en Terreno** | Flujo secuencial M2→M1(rechazado)→M3 sobre estado compartido; verifica 0 contaminación de logs | 4/4 ✅ |
| **Unitario — Servicios backend** | Suite completa de dominio (incl. `blockNegativeStock`, M1→`performTransactionCore`, fracciones UoM) | 391/391 ✅ |
| **Componente Angular — Lógica** | `meterHistoryRows`: delta, orden, traducción de fuentes, preview | 20/20 ✅ |
| **Componente Angular — Rendering** | Tabla de historial: filas, delta `+50 Hrs`, etiquetas, CSS | 22/22 ✅ |
| **Formularios M1 / OT** | `lube-report-form` + `work-order-form` integrados con `app-fluid-quantity-row` | build ✅ |

---

## Guía de verificación para QA

### Escenario 1 — Ciclo de turno completo

1. Ingresar como supervisor y abrir **Operaciones → Disponibilidad → Nuevo**.
2. Registrar el equipo `EC-001` en estado Operativo, turno Día, con horómetro `1050`.
3. Verificar que en el modal del equipo (Flota → `EC-001`) la pestaña **Historial de Medidores** muestra la entrada `1000 → 1050` con fuente "Reporte de disponibilidad".

### Escenario 2 — Rechazo de horómetro regresivo en M1

1. Desde **Operaciones → Lubricantes → Nuevo**, seleccionar el mismo equipo con horómetro `1040` (menor al actual `1050`).
2. Verificar que el sistema muestra un error y **no guarda** el despacho.

### Escenario 3 — Falla ALTA detiene el equipo

1. Desde **Operaciones → Fallas → Nueva**, registrar una falla de criticidad **ALTA** con horómetro `1100`.
2. Verificar que:
   - El equipo aparece como **Fuera de Servicio** en el listado de Flota.
   - Se creó automáticamente una OT con categoría "No Programada Reactiva".
   - El historial de medidores muestra la entrada `1050 → 1100` con fuente "Reporte de falla".
   - Los usuarios del contrato recibieron la notificación push.

### Escenario 4 — Carga masiva M2 desde Excel

1. Desde **Operaciones → Disponibilidad → Importar Excel**, descargar la plantilla del turno actual.
2. Completar los estados en el archivo descargado y subirlo.
3. Verificar la previsualización y confirmar la importación.
4. Verificar que los equipos completados ya no aparecen en la lista de "sin reportar" del dashboard.

### Escenario 5 — Integridad de fluidos en M1 (stock y decimales)

1. En **Ajustes → Empresa**, activar «Bloquear stock negativo» y guardar.
2. Desde **Operaciones → Lubricantes → Nuevo**, elegir bodega virtual, equipo y un lubricante con stock conocido (p. ej. 5 LT).
3. Ingresar cantidad **6** → verificar badge rojo, mensaje de stock insuficiente y botón Guardar deshabilitado.
4. Desactivar el bloqueo, repetir con cantidad 6 → aviso ámbar (regularización pendiente) pero permite guardar si el resto del formulario es válido.
5. Probar artículo con UoM entera (`allowsDecimals=false`) ingresando `2.5` → error de formato y bloqueo de guardado.

### Escenario 6 — Fluidos en cierre de OT

1. Abrir una OT en progreso con bodega de consumo asignada; agregar fluido desde catálogo.
2. Verificar badge «Disponible» y unidad correcta (no label fijo «Litros»).
3. Ingresar cantidad > umbral lógico (p. ej. 120 LT) sin marcar confirmación → bloqueo de cierre.
4. Marcar «Confirmar cantidad inusual» y cerrar OT → verificar kardex `WORK_ORDER_ISSUE` y costo imputado.

---

## Cambios técnicos para el equipo de desarrollo

- **Migración:** `20260604120000_tenant_block_negative_stock` — columna `block_negative_stock` en `tenant_operational_configs` (default `false`). Ejecutar `npx prisma migrate deploy` en local/QA antes de probar el toggle.
- **Utils compartidos:** `backend/src/common/inventory/stock-quantity.util.ts`, `fluid-dispatch-limits.util.ts` (backend y mirror FE en `shared/utils/`).
- **Núcleo de stock:** M1 (`LubeReportsService`) y cierre OT (`WorkOrdersService`) delegan descuentos a `InventoryStockService.performTransactionCore`.
- **Picker inventario:** campo `stockAvailableQuantity` en filas del catálogo (físico − reservas).
- **Frontend shared:** `app-fluid-quantity-row` — inputs `itemId`, `warehouseId`, `allowsDecimals`, `availableStock`, `FormControl`, emite `validationChange` y `confirmedLargeDispatchChange`.
- **DTOs:** `LubeReportLineDto.confirmedLargeDispatch`; cierre OT acepta `confirmedLargeFluidDispatch` en body de `PATCH .../status`.
- Endpoints M2 (sin cambios respecto a v1.0 base): `GET /equipment-availability/unreported`, export/import Excel.
- Endpoints M3: `POST /fault-reports/:id/attachments`, `GET /fault-reports/:id/attachments/:attachmentId/download`.
- El evento `EQUIPMENT_DOWN` está registrado en [`docs/agentes/notificaciones-sistema.md`](../agentes/notificaciones-sistema.md) y la plantilla de correo en [`docs/CORREOS-SISTEMA.md`](../CORREOS-SISTEMA.md).

---

## Limitaciones conocidas y próximos pasos

| Limitación | Impacto | Planificado para |
|------------|---------|-----------------|
| El dashboard no muestra KPIs cruzados en tiempo real (PMs próximas, semáforo de flota) | Medio — requiere navegación manual a Flota | v1.1 |
| La notificación push de "PM próxima" no está implementada (requiere campo anti-spam en schema) | Bajo — el cálculo visual ya existe en el modal | v1.1 |
| Los reportes de disponibilidad no se agregan aún en un reporte ejecutivo mensual exportable | Bajo — la data existe, falta la vista de reporte | v1.2 |
| `ItemStock.quantity` sigue siendo `Float` en Postgres; la precisión se garantiza en runtime con `Decimal.js` | Bajo — migración a `Decimal` en schema evaluable en v1.2 | v1.2 |

---

## Archivos de referencia

| Documento | Descripción |
|-----------|-------------|
| [`docs/agentes/sistema-integrado-roadmap.md`](../agentes/sistema-integrado-roadmap.md) | Roadmap completo de integración transversal |
| [`docs/MASTER-CONTEXT.md`](../MASTER-CONTEXT.md) | Arquitectura de datos y señales SSOT (`currentMeter`, `isOperational`) |
| [`docs/agentes/notificaciones-sistema.md`](../agentes/notificaciones-sistema.md) | Catálogo de eventos push y correo |
| [`docs/CORREOS-SISTEMA.md`](../CORREOS-SISTEMA.md) | Plantillas de correos transaccionales |
| [`docs/agentes/decisiones.md`](../agentes/decisiones.md) | Decisiones de diseño tomadas durante el desarrollo |

---

*Preparado por: Equipo TPM / BaseLogic — Agente Cursor (sesiones 2026-06-03 / 2026-06-04)*  
*Aprobación técnica pendiente antes del merge a `main`.*
