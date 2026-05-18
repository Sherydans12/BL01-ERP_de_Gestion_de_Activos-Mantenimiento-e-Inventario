# PDF por HTML + Playwright — plantilla base (BL01)

Este documento fija el **patrón oficial** para PDFs generados en el backend: **HTML (plantilla en string) + Chromium (Playwright) → `page.pdf()`**. La implementación de referencia es la **orden de compra (OC)**; otros documentos (guías de despacho, informes, etc.) deben **reutilizar la estructura y convenciones**, no copiar ciegamente bloques de negocio que no correspondan (p. ej. proveedor en un PDF interno).

## Referencia en código

| Pieza | Ubicación |
|-------|-----------|
| Plantilla OC + helpers | `backend/src/features/purchases/purchase-order-pdf.generator.ts` |
| Plantilla SRC (resumen) | `backend/src/features/purchases/purchase-requisition-pdf.generator.ts` |
| Plantilla reporte ejecutivo compras | `backend/src/features/purchases/purchases-analytics-report-pdf.generator.ts` |
| Stream PDF OC (include Prisma + `pdfLogoUrl`; merge aviso/razón social desde `tenants`) | `backend/src/features/purchases/purchase-orders.service.ts` → `getPurchaseOrderPdfStream` |
| Stream PDF SRC | `backend/src/features/purchases/purchase-requisitions.service.ts` → `getRequisitionPdfStream` |
| PDF OC HTTP (`Cache-Control: no-store`) | `backend/src/features/purchases/purchase-orders.controller.ts` → `GET :id/pdf` |
| PDF SRC HTTP | `backend/src/features/purchases/purchase-requisitions.controller.ts` → `GET :id/pdf` |
| Chromium en imagen Docker | `backend/Dockerfile` (deps sistema + `playwright install chromium` en runner) |
| Variable ejecutable opcional | `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` |

## Flujo técnico

1. **Tipado** del payload mínimo (`PoPdfOrder`, etc.) alineado con el `select`/`include` de Prisma que alimenta el PDF.
2. **Función `build*Html(...)`** que devuelve un string HTML completo (`<!DOCTYPE html>…`), con `<style>` embebido (sin dependencia de assets externos salvo `data:` opcionales, p. ej. logo).
3. **`escapeHtml()`** en todo texto que provenga de BD, DTO o usuario (evita XSS en HTML intermedio y caracteres rotos en PDF).
4. **`generate*PdfBuffer()`**: `chromium.launch` → `newPage()` → `setContent(html, { waitUntil: 'load' })` → `page.pdf({ format: 'A4', printBackground: true, margin: … })` → `Buffer`.
5. **Args recomendados** en headless: `--disable-dev-shm-usage`, `--no-sandbox` (contenedor Linux).

## Estructura de layout (plantilla base)

Orden conceptual reutilizable; **omití** bloques que el documento no necesite.

1. **`<div class="wrap">`** — ancho máximo coherente con A4 (~190mm útil).
2. **Cabecera (`div.top`)** — dos columnas principales (`flex`, `space-between`):
   - **Izquierda (`div.top-doc` → `div.doc-brand`)**: columna vertical alineada al inicio:
     - **Logo** arriba (`div.logo-corner`): imagen `data:` o placeholder con iniciales; tamaño acotado con `max-height` / `max-width` (no usar el asset 480×120 a tamaño real).
     - **Título** (`h1` en `div.title-block`) debajo del logo con el espaciado definido (`gap` + `padding-top` en `.title-block`).
     - **Estado o subtítulo** (`p.doc-status`): badge legible (aprox. **10–10,5 px**, negrita), **no** mezclado con la clase `.muted` del cuerpo. Para OC y SRC, mapear el enum de Prisma a español (`*StatusLabelEs`) y a un modificador de color (`doc-status--pending`, `doc-status--warning`, `doc-status--success`, `doc-status--danger`, `doc-status--progress`, `doc-status--done`, `doc-status--closed`, `doc-status--neutral`). Incluir `print-color-adjust: exact` en el badge para que el fondo se imprima en Chromium.
   - **Derecha (`div.meta`)**: `table.meta-t` con filas etiqueta/valor; primera columna en **negrita** vía `table.meta-t td:first-child` (Rut, correlativo, contrato/subcontrato, etc.).
3. **Bloque contextual** opcional (en OC: “Destino / imputación”; en otros: resumen, período, faena).
4. **Tablas de datos** (`table.grid2`):
   - Primera columna de etiquetas con clase **`lbl`** (`font-weight: 700`, color oscuro).
   - Celdas de valor sin negrita; `colspan` cuando haga falta.
   - **No** mezclar en una sola celda centrada un dato sin etiqueta (p. ej. contrato): usar fila “Contrato” / “Subcontrato” + valor.
5. **Tabla maestra de líneas** (`table.items`): `table-layout: fixed`, `<colgroup>` con porcentajes, descripción con `overflow-wrap`, `thead` repetible en impresión.
6. **Pie** (`div.foot`): tablas auxiliares + totales (`table.totals` con primera columna en negrita; fila total con clase `b` si aplica).
7. **Nota legal / pie de página** opcional (generación electrónica, correlativo, etc.).

## Configuración del aviso legal (PDF OC)

El recuadro destacado bajo RUT/contrato en la OC toma el texto de **`Tenant.ocPdfLegalNotice`** (`oc_pdf_legal_notice`, multilínea). Se edita en **Configuración → Empresa** (ventana **Compras y PDF de orden de compra**): **Guardar en servidor** persiste razón social + aviso; el **logo ancho de PDFs** se sube o quita en esa misma ventana (campo **`Tenant.pdfLogoUrl`**). El **Guardar cambios** del pie aplica todo el formulario de empresa. Si el aviso queda vacío, `purchase-order-pdf.generator.ts` usa el arreglo por defecto `DEFAULT_OC_PDF_LEGAL_NOTICE_LINES` (cada línea se escapa con `escapeHtml` y se une con `<br/>`).

## Estilo y legibilidad

- **Tipografía**: `system-ui`, tamaño ~9–10px cuerpo; bordes `#0f172a` para tablas tipo formulario.
- **Acento**: variable CSS `--accent` desde color de marca del tenant cuando aplique.
- **Etiquetas**: clase **`.lbl`** en `grid2`; meta con **`td:first-child`**; totales con **`.totals tr > td:first-child`**.
- **Estado en cabecera**: patrón **`.doc-status`** + **`.doc-status-k`** (etiqueta corta en mayúsculas, p. ej. `Estado:`) + texto ya escapado con `escapeHtml`. Los modificadores `--*` deben derivarse solo de valores de enum conocidos (nunca de texto libre de usuario). Informes sin “estado de workflow” pueden usar **`doc-status--caption`** (misma jerarquía visual, tono informativo).
- **Impresión**: `@page { size: A4; margin: … }` alineado con `page.pdf({ margin })`.
- **Paginación**: evitar decenas de filas vacías de relleno; si se usa relleno estético, acotar por reglas de negocio (ej. OC: N filas extra solo si pocas líneas ocupadas).

## Contenido específico de OC (no obligatorio en otros PDFs)

- Bloque **proveedor** (razón social, RUT, dirección, condición de pago, etc.).
- Tabla de **ítems** con cantidades y montos.
- Mapeo **`PurchaseOrderStatus` → español** (`purchaseOrderStatusLabelEs` o equivalente por enum) y **badge de cabecera** (`purchaseOrderStatusBadgeMod` → clases `doc-status--*`).
- **Pie (tabla bajo ítems)**: trazabilidad SRC en una sola fila centrada (`.foot-req-ref`): «Según requerimiento Nº **&lt;correlativo&gt;** del sistema EAM BaseLogic» (correlativo con `escapeHtml`).

**SRC (resumen PDF):** mismo patrón de badge en cabecera: `requisitionStatusLabelEs` + `requisitionStatusBadgeMod` (estados del requerimiento).

**Reporte ejecutivo de compras:** línea bajo el título con `doc-status doc-status--caption` (contexto del informe, no enum de workflow).

Para un **nuevo** documento: creá un generador dedicado (p. ej. `*-pdf.generator.ts`), tipá el DTO mínimo y copiá solo la **estructura HTML/CSS** y el **pipeline Playwright**; sustituí bloques por los campos del dominio.

## Seguridad y datos

- Tratar el HTML como **salida**: siempre escapar textos variables.
- No incrustar URLs arbitrarias sin control (logo en PDF: preferir `data:image/...` resuelto en servidor desde **`Tenant.pdfLogoUrl`** vía storage; el logo del **menú lateral** usa solo **`Tenant.logoUrl`** en Configuración → Empresa → Identidad visual).
- No loguear HTML completo en producción (ruido y fuga de datos).

## Pruebas locales

- Requiere Chromium instalado (Docker ya lo hace; en dev: `npx playwright install chromium` en `backend/` si falla el launch).
- Regenerar PDF desde la API/UI y revisar **una y varias páginas** según cantidad de líneas reales.

## Relación con otros documentos

- **Correos HTML**: flujo distinto (`Mailer`, plantillas Handlebars); ver [correos-transaccionales.md](correos-transaccionales.md).
- **Compras (negocio OC)**: [../PURCHASE-FLOWS.md](../PURCHASE-FLOWS.md).

Al añadir un PDF nuevo que siga este patrón, enlazalo desde aquí (tabla “Implementaciones”) o desde `AGENTS.md` si es transversal.

### Implementaciones

| Documento | Generador |
|-----------|-----------|
| Orden de compra (OC) | `purchase-order-pdf.generator.ts` |
| Requerimiento de compra (SRC) — resumen | `purchase-requisition-pdf.generator.ts` |
| Reporte ejecutivo de compras (analytics) | `purchases-analytics-report-pdf.generator.ts` |
