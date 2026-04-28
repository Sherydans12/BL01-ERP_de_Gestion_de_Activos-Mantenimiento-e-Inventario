# Correos transaccionales (TPM / BaseLogic)

## Dónde está el código

- Plantilla base y firma: `backend/src/common/email/email-templates.ts` (`buildTpmEmailHtml`, `escapeHtml`, `getSystemEmailSignatureHtml`).
- Cuerpos por flujo: `backend/src/common/email/transactional-mail.builder.ts` (invitación, reenvío, recuperación, acceso inusual).
- Generador de galería local: `backend/src/common/email/preview-renderer.ts`.

## Previsualizar en local (obligatorio al añadir o cambiar un correo)

Desde la carpeta **`backend`**:

```bash
npm run email-previews
```

Eso regenera los HTML en **`docs/email-previews/`** (p. ej. `index.html`, `01-invitacion.html`, etc.) a partir de las **mismas** funciones que usa el API.

**Cómo verlos:** abrir en el navegador `docs/email-previews/index.html` (doble clic o “Open with Live Server”).

## Regla para agentes e implementadores

1. Cada **nuevo** correo transaccional que use la plantilla debe exponerse en `preview-renderer.ts` (entradas en el array `SAMPLES`) y volver a ejecutar `npm run email-previews` para actualizar la galería.
2. Si el correo es un HTML suelto (p. ej. avisos de OT/garantía), considerar migrarlo a `buildTpmEmailHtml` o, como mínimo, documentar en el PR que aún no está en la galería.
3. Tras cambiar copy o estilos en el builder, **regenerar** la galería para que `docs/email-previews/` no quede desactualizada respecto al runtime.

## Script en package.json

Definido en `backend/package.json` como `email-previews` (ver campo `scripts`).
