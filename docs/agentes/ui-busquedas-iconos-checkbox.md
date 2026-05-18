# UI — búsquedas (lupa), placeholders y checkboxes custom

## 1. Lupa duplicada en campos de búsqueda

**Causa típica:** `type="search"` + icono SVG (o decoración) en HTML, mientras el motor (WebKit/Blink/Firefox) sigue pintando **controles nativos** (lupa, botón limpiar) según `appearance` y pseudo-elementos.

**Qué hace el proyecto:**

- En `frontend/src/styles.scss` (`@layer base`), `input[type='search']` usa **`appearance: none`** (y equivalentes WebKit/Mozilla) y se anulan pseudo-elementos WebKit + **`::-moz-search-clear-button`** en Firefox.
- Para campos con **lupa propia** en el markup (SRC, stock, usuarios, flota…), conviene **`type="text"`** + **`role="searchbox"`** + **`inputmode="search"`** + **`spellcheck="false"`**: teclado “buscar” en móvil, sin ambigüedad con el UA. Referencia: `user-management.component.ts` (búsqueda de usuarios).

**Evitar:** volver a poner `appearance: textfield` solo sobre `type="search"` si ya hay icono manual; reintroduce el riesgo de duplicado según motor y versión.

## 2. Checkbox con “doble” tilde / marca

**Causa:** en `styles.scss`, la regla base `input[type='checkbox']` tenía **mayor especificidad** que la utilidad Tailwind **`appearance-none`** de los checkboxes diseñados (p. ej. `after:content-['✓']` en **Alta de artículo** → “Clasificación del artículo”). El motor seguía dibujando el control nativo **y** el pseudo-elemento del diseño.

**Corrección aplicada:** envolver esas reglas en **`:where(input[type='checkbox']), :where(input[type='radio'])`** para especificidad 0, de modo que `appearance-none` y el resto de utilidades ganen la cascada.

**Al añadir nuevos checkboxes “dibujados” a mano:** usar el mismo patrón (`appearance-none` + estados `checked:`) sin duplicar reglas globales con mayor especificidad sobre `input[type='checkbox']`.

## 3. Placeholders

Los placeholders vienen del atributo HTML; si un icono “parece” duplicado, revisar primero si no es **UI nativa** del `type` (caso `search`) antes de tocar el texto del `placeholder`.

## Referencias en código

| Área | Archivo |
|------|---------|
| Reset global `search` / checkbox | `frontend/src/styles.scss` (`@layer base`) |
| Búsqueda SRC (text + searchbox) | `frontend/src/app/features/purchases/requisition-list/requisition-list.component.html` |
| Búsqueda stock | `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.html` |
| Checkboxes clasificación | `frontend/src/app/features/inventory-items/inventory-item-form/inventory-item-form.component.html` |

Relacionado: [ui-modales-tema-claro.md](ui-modales-tema-claro.md) (contraste tema claro en overlays).
