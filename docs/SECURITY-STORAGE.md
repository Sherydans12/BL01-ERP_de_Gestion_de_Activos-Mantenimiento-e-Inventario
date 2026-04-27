# Security Storage Runbook (R2 Key Rotation)

Este documento define la rotacion de credenciales de Cloudflare R2 sin downtime para el backend.

## Variables involucradas

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ENDPOINT` (si aplica)

## Objetivo

Renovar credenciales de acceso a R2 sin cortar cargas ni lectura de archivos firmados.

## Proceso seguro (2 pasos)

### Paso 1: Alta de nueva key y despliegue

1. Crear una nueva API token/key en Cloudflare R2 con permisos minimos requeridos (`Object Read`, `Object Write` sobre el bucket productivo).
2. En Coolify (servicio backend), reemplazar:
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
3. Mantener la key antigua activa en Cloudflare durante la propagacion.
4. Ejecutar redeploy del backend.
5. Validar:
   - subida de avatar,
   - subida de documento de compra,
   - resolucion de `GET /api/storage/resolve?key=...`,
   - acceso firmado expira correctamente (5 minutos).

### Paso 2: Espera corta y revocacion de key antigua

1. Esperar ventana de propagacion operacional (recomendado: 15 a 30 minutos).
2. Revisar logs de backend y confirmar que no hay errores de autenticacion S3/R2.
3. Revocar/eliminar la key antigua en Cloudflare.
4. Confirmar nuevamente operaciones de carga y lectura.

## Rollback

Si falla el despliegue con la nueva key:

1. Restaurar en Coolify los valores anteriores de:
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
2. Redeploy inmediato.
3. Analizar permisos de la nueva key antes de reintentar.

## Buenas practicas

- No reutilizar keys entre ambientes.
- Rotar en ventana controlada y con monitoreo de logs.
- No registrar secretos en commits ni en logs de aplicacion.
- Documentar fecha de rotacion y responsable en runbook interno.
