# Quick-add + `GlobalItemPicker` y `<dialog>` nativos (TPM / Angular)

## Contexto

- **`app-global-item-picker`** usa `<dialog>` + `showModal()`.
- **`app-quick-add-item-modal`** no es `<dialog>`: es un `div` a pantalla completa con `z-index` y fondo semitransparente.
- En **Control de stock → Nuevo movimiento**, primero se abre el `<dialog>` de **Operación de almacén** y, desde ahí, el catálogo maestro. Hay **dos** diálogos nativos en juego antes de abrir el alta rápida.

## Bug conocido (2026-05)

Si `app-quick-add-item-modal` recibe **`overlayInsideDialog=true`**, el overlay usa **`position: absolute`** respecto al `<dialog>` del picker. En la cascada **operación de bodega + catálogo**, el alta rápida queda **visualmente encajonada** / mal apilada “dentro” del modal anterior.

**Corrección:** en `global-item-picker.component.html` el quick-add debe usar **`[overlayInsideDialog]="false"`** (overlay `fixed` al viewport).

## Reglas para agentes / PRs

1. **No cambiar** `overlayInsideDialog` a `true` en `GlobalItemPicker` sin probar **Nuevo movimiento → Entrada por compra → Buscar o crear → + Nuevo artículo**.
2. **`overlayInsideDialog=true`** solo tiene sentido si el quick-add está **dentro** de un contenedor con posición/scroll **y no** hay otro `<dialog>` nativo abierto detrás que deba quedar por debajo del overlay de alta rápida (caso raro en este repo).
3. Si se introduce un tercer nivel de UI modal, preferir **un solo** `<dialog>` a la vez (cerrar el anterior) o documentar aquí el nuevo flujo.
4. **Errores globales (toasts)** sobre el picker: ver [ui-notificaciones-toasts-top-layer.md](ui-notificaciones-toasts-top-layer.md) — el `<dialog>` nativo usa **top layer**; no basta con subir `z-index` al toast.

## Código

| Archivo | Nota |
|---------|------|
| `frontend/.../global-item-picker/global-item-picker.component.html` | Pasa `overlayInsideDialog` al quick-add |
| `frontend/.../quick-add-item-modal/quick-add-item-modal.component.html` | `fixed` vs `absolute` según el flag |
| `frontend/.../quick-add-item-modal/quick-add-item-modal.component.ts` | `@Input() overlayInsideDialog` |

---
*Índice:* [README.md](README.md) · Catálogo / política stock: [inventario-alta-articulos-y-selector-global.md](inventario-alta-articulos-y-selector-global.md)
