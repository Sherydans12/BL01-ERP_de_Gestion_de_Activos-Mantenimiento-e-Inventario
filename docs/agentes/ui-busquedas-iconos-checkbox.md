# UI — búsquedas (lupa), placeholders y checkboxes custom

## 1. Lupa duplicada en campos de búsqueda

**Causa típica:** `type="search"` + icono SVG (o decoración) en HTML, mientras el motor (WebKit/Blink/Firefox) sigue pintando **controles nativos** (lupa, botón limpiar) según `appearance` y pseudo-elementos.

**Segunda causa (Chromium con `type="text"`):** aunque el input sea texto, Blink puede insertar un contenedor interno **`::-webkit-textfield-decoration-container`** (segunda lupa / chip) si el campo se comporta como búsqueda (`inputmode="search"`, contexto, etc.).

**Qué hace el proyecto:**

- En `frontend/src/styles.scss` (`@layer base`), `input[type='search']` usa **`appearance: none`** (y equivalentes WebKit/Mozilla) y se anulan pseudo-elementos WebKit + **`::-moz-search-clear-button`** en Firefox.
- Clase **`tpm-input-leading-icon`** en el `<input>` que ya tiene lupa SVG a la izquierda: en `@layer components` se oculta **`::-webkit-textfield-decoration-container`** (ver `styles.scss`).
- Campos con lupa propia: **`type="text"`** + **`inputmode="search"`** (teclado en móvil) + clase anterior; **`role="searchbox"`** se evita en estos campos para no forzar heurísticas raras del motor.

**Evitar:** volver a poner `appearance: textfield` solo sobre `type="search"` si ya hay icono manual; reintroduce el riesgo de duplicado según motor y versión.

## 2. Checkbox con “doble” tilde / marca

**Causa:** en `styles.scss`, la regla base `input[type='checkbox']` tenía **mayor especificidad** que la utilidad Tailwind **`appearance-none`** de los checkboxes diseñados (p. ej. `after:content-['✓']` en **Alta de artículo** → “Clasificación del artículo”). El motor seguía dibujando el control nativo **y** el pseudo-elemento del diseño.

**Corrección aplicada:** envolver esas reglas en **`:where(input[type='checkbox']), :where(input[type='radio'])`** para especificidad 0, de modo que `appearance-none` y el resto de utilidades ganen la cascada.

**Marca corrida a un lado del cuadrado:** el `::after` con el ✓ debe ir **`absolute` + `left-1/2` + `top-1/2` + `-translate-x-1/2` + `-translate-y-1/2`** sobre un `<input type="checkbox" class="relative …">`. En **Alta de artículo** está centralizado vía `classificationCheckboxClass` en `inventory-item-form.component.ts`.

**Al añadir nuevos checkboxes “dibujados” a mano:** mismo patrón de centrado del pseudo-elemento; no duplicar reglas globales con mayor especificidad sobre `input[type='checkbox']`.

## 3. Placeholders

Los placeholders vienen del atributo HTML; si un icono “parece” duplicado, revisar primero si no es **UI nativa** del `type` (caso `search`) o el contenedor WebKit de la §1 antes de tocar el texto del `placeholder`.

## Referencias en código

| Área | Archivo |
|------|---------|
| Reset global `search` / checkbox + clase `.tpm-input-leading-icon` | `frontend/src/styles.scss` |
| Búsqueda SRC | `frontend/src/app/features/purchases/requisition-list/requisition-list.component.html` |
| Búsqueda stock | `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.html` |
| Búsqueda flota | `frontend/src/app/features/fleet/fleet-master/fleet-master.component.html` |
| Búsqueda usuarios (grid con icono) | `frontend/src/app/features/users/user-management/user-management.component.ts` (template inline) |
| Checkboxes clasificación | `inventory-item-form.component.html` + `.ts` (`classificationCheckboxClass`) |

Relacionado: [ui-modales-tema-claro.md](ui-modales-tema-claro.md) (contraste tema claro en overlays).
