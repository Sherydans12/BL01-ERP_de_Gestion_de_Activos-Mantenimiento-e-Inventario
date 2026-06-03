# Notas de Liberación — Módulo de Operaciones en Terreno v1.0

**Producto:** TPM — Gestión de Activos y EAM  
**Versión del módulo:** Operations v1.0  
**Fecha de liberación:** 2026-06-03  
**Entorno objetivo:** QA (Coolify) → Producción  
**Clasificación:** Mayor · Primera liberación del módulo operativo integrado

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
- Descuento de stock en tiempo real desde la bodega virtual del camión lubricador.
- Lectura de horómetro opcional: si el operario la ingresa, el sistema actualiza el contador de horas del equipo. Si la lectura fuera menor a la última registrada, el sistema la **rechaza** con un mensaje claro — el horómetro nunca retrocede.
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
| **Integración — Caos en Terreno** | Flujo secuencial M2→M1(rechazado)→M3 sobre estado compartido; verifica 0 contaminación de logs | 4/4 ✅ |
| **Unitario — Servicios backend** | Suite completa de dominio | 376/376 ✅ |
| **Componente Angular — Lógica** | `meterHistoryRows`: delta, orden, traducción de fuentes, preview | 20/20 ✅ |
| **Componente Angular — Rendering** | Tabla de historial: filas, delta `+50 Hrs`, etiquetas, CSS | 22/22 ✅ |

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

---

## Cambios técnicos para el equipo de desarrollo

- **Sin migraciones de base de datos** en esta versión (el schema es el de la v0.9 con la columna `quantityConfirmed` en `receipt_items` ya aplicada).
- Nuevos endpoints: `GET /equipment-availability/unreported`, `POST /equipment-availability/export-template`, `POST /equipment-availability/import/validate`, `POST /equipment-availability/import/commit`.
- Nuevos endpoints M3: `POST /fault-reports/:id/attachments`, `GET /fault-reports/:id/attachments/:attachmentId/download`.
- El evento `EQUIPMENT_DOWN` está registrado en [`docs/agentes/notificaciones-sistema.md`](../agentes/notificaciones-sistema.md) y la plantilla de correo en [`docs/CORREOS-SISTEMA.md`](../CORREOS-SISTEMA.md).

---

## Limitaciones conocidas y próximos pasos

| Limitación | Impacto | Planificado para |
|------------|---------|-----------------|
| El dashboard no muestra KPIs cruzados en tiempo real (PMs próximas, semáforo de flota) | Medio — requiere navegación manual a Flota | v1.1 |
| La notificación push de "PM próxima" no está implementada (requiere campo anti-spam en schema) | Bajo — el cálculo visual ya existe en el modal | v1.1 |
| Los reportes de disponibilidad no se agregan aún en un reporte ejecutivo mensual exportable | Bajo — la data existe, falta la vista de reporte | v1.2 |

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

*Preparado por: Equipo TPM / BaseLogic — Agente Cursor (sesión 2026-06-03)*  
*Aprobación técnica pendiente antes del merge a `main`.*
