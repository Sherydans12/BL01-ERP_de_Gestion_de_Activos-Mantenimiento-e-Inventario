# UI — modales y tema claro (`data-theme='light'`)

En modo claro, **`--bg-dark`** y **`--bg-surface`** del proyecto **no** son oscuros: vienen de `frontend/src/styles.scss` (`[data-theme='light']`). Cualquier modal que use **`text-white`**, **`text-gray-300`** fijo o “cabecera oscura” asumiendo fondo `#0A0F14` quedará **ilegible** o con contraste pobre.

## Reglas para nuevos modales

1. **Texto:** preferir tokens Tailwind del TPM — `text-main`, `text-muted`, `text-primary` — no `text-white` / grises sueltos sobre `bg-dark`.
2. **Fondos:** `bg-surface`, `bg-sidebar`, `bg-dark` son **semánticos** (cambian con el tema). Si el panel usa `rgba(…, 0.8)` + blur en claro y el `<dialog>` tiene backdrop oscuro, el contraste puede fallar: usar **panel opaco** en claro.
3. **Overrides globales:** si hace falta forzar opacidad solo en claro, seguir el patrón de **`equipment-detail-modal-panel`** en `styles.scss`: bloque `[data-theme='light'] .mi-modal-panel { background-color: #ffffff !important; … }`.
4. **`app-confirm-modal`:** componente compartido en `frontend/src/app/shared/components/confirm-modal/confirm-modal.component.ts` — lleva clases **`confirm-dialog-panel`**, **`confirm-dialog-header`**, **`confirm-dialog-footer`**; los overrides en claro están en **`frontend/src/styles.scss`** (buscar `confirm-dialog-panel`).
5. **Encapsulación Angular:** si un `.scss` de componente no reacciona a `[data-theme='light']` en `<html>`, usar **`:host-context([data-theme='light'])`** (ver notas en OT / rail de pestañas).

## Referencias

- Tokens y shell: `.cursor/rules/tpm-arquitectura.mdc` (sección 5 — modo claro / superficies críticas).
- Variables CSS: `frontend/src/styles.scss` (`:root` y `[data-theme='light']`).
- Ejemplo de modal con overrides: comentarios `equipment-detail-modal-*` y `confirm-dialog-*` en el mismo `styles.scss`.
- Búsquedas / checkboxes y cascada global: [ui-busquedas-iconos-checkbox.md](ui-busquedas-iconos-checkbox.md).
