# Toasts y capa superior del navegador (`<dialog>` / top layer)

## Problema

Los toasts globales (`app-toast` en `app.component.html`) viven en el documento normal con `position: fixed` y un `z-index` alto (`z-[9999]` en `toast.component.ts`).

Los flujos de **selector de artículos** (`app-global-item-picker`) usan **`<dialog>` nativo** con `showModal()`. Ese patrón coloca el diálogo en el **top layer** del motor (por encima de cualquier stacking context del documento, **independiente del `z-index`** de nodos fuera del top layer).

**Síntoma:** un `NotificationService.error(...)` disparado desde `QuickAddItemModal` (abierto encima del picker) **no se ve**: el toast queda **debajo** del `<dialog>`.

Subir solo el `z-index` del contenedor de toasts **no** soluciona el caso mientras el toast siga renderizado fuera del top layer.

## Solución en este repo

En `toast.component.ts`, el contenedor de la pila de toasts usa **`popover="manual"`** cuando el navegador expone la **Popover API** (`'popover' in HTMLElement.prototype`). Un `effect()` abre/cierra el popover con `showPopover()` / `hidePopover()` según haya toasts activos, de modo que el host entra en el **mismo mecanismo de top layer** y queda por encima de `<dialog>`.

Si el navegador no soporta popover, se mantiene el comportamiento anterior (`z-[9999]` sin atributo `popover`).

## Reglas para agentes / PRs

1. **No asumir** que “subí el z-index a 99999” hará visible un aviso sobre un `<dialog showModal>`: revisar este documento.
2. **Nuevos overlays** que deban tapar toasts de forma intencionada son raros; si se añade otro mecanismo de top layer (segundo `<dialog>`, `popover`, etc.), documentar el orden esperado de apilamiento.
3. **Errores en modales** que no usen `NotificationService`: seguir priorizando feedback **inline** en el formulario además del toast, para entornos sin Popover API o para lectores de pantalla.

## Referencias de código

| Archivo | Rol |
|---------|-----|
| `frontend/src/app/shared/components/toast/toast.component.ts` | Host `popover="manual"` + `effect` |
| `frontend/src/app/app.component.html` | `<app-toast />` junto al `router-outlet` |
| `frontend/src/app/shared/components/global-item-picker/global-item-picker.component.html` | `<dialog>` del picker |
| [ui-quickadd-global-picker-dialogos-nativos.md](ui-quickadd-global-picker-dialogos-nativos.md) | Cascada picker + quick-add |

---
*Índice:* [README.md](README.md)
