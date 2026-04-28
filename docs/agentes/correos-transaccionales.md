# Correos transaccionales (TPM / BaseLogic)

## Dónde está el código

- Plantilla base y firma: `backend/src/common/email/email-templates.ts` (`buildTpmEmailHtml`, `escapeHtml`, `getSystemEmailSignatureHtml`).
- Cuerpos por flujo: `backend/src/common/email/transactional-mail.builder.ts` (invitación, reenvío, recuperación, acceso inusual).
- Generador de galería local: `backend/src/common/email/preview-renderer.ts`.

## Formato base (obligatorio para correos nuevos)

**No** inventar HTML suelto en servicios (bloques `<div style="...">` con colores arbitrarios, botones “rozados” antiguos, etc.). Todos los **correos transaccionales** nuevos deben apoyarse en el mismo estándar:

1. **`buildTpmEmailHtml()`** en `email-templates.ts` — define el documento (fondo oscuro industrial, tarjeta con acento cyan, tipografía, CTA unificado, **pie de firma BaseLogic** con `getSystemEmailSignatureHtml()` al final). Es la **base visual y de marca** del producto.
2. **`escapeHtml()`** — cualquier dato de usuario, rol, enlace en texto, ciudad, etc. pasa por aquí; el `headline` / `subhead` se escapan dentro de `buildTpmEmailHtml` al insertarlos.
3. **`transactional-mail.builder.ts`** — añadí aquí **una función exportada por tipo de correo** (p. ej. `buildMailFooBar(...)`) que solo compone `bodyHtml`, CTA y notas, y devuelve el `string` completo con `buildTpmEmailHtml`. Así el servicio (`auth.service`, `users.service`, etc.) solo hace `sendMail({ html: buildMail...(...) })`.
4. Excepciones puntuales (p. ej. notificación mínima de otra feature) — si aún no encajan con la plantilla, **documentarlo** y planear alinear luego; no clonar el estilo “a mano” sin criterio.

Resumen: **nuevo correo = extender el builder o `buildTpmEmailHtml` con el mismo patrón**, nunca un template paralelo con otro look.

## Previsualizar en local (obligatorio al añadir o cambiar un correo)

Desde la carpeta **`backend`**:

```bash
npm run email-previews
```

Eso regenera los HTML en **`docs/email-previews/`** (p. ej. `index.html`, `01-invitacion.html`, etc.) a partir de las **mismas** funciones que usa el API.

**Cómo verlos:** abrir en el navegador `docs/email-previews/index.html` (doble clic o “Open with Live Server”).

## Regla para agentes e implementadores

1. Cada **nuevo** correo que use `buildTpmEmailHtml` / el builder: añade una **entrada** en el array `SAMPLES` de `preview-renderer.ts` y vuelve a ejecutar `npm run email-previews` para publicar en la galería.
2. Avisos legacy (OT/garantía, compras, etc. con HTML mínimo) — prioridad de migración a `buildTpmEmailHtml` + builder; mientras sigan viejos, dejar nota clara (PR o comentario en servicio) de que aún no siguen el formato unificado.
3. Tras cambiar copy, estilos o tokens en `email-templates.ts` / `transactional-mail.builder.ts`, **regenerar** `docs/email-previews/` con el comando anterior.

## Script en package.json

Definido en `backend/package.json` como `email-previews` (ver campo `scripts`).
