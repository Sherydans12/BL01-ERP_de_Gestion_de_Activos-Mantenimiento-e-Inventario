# Security Storage Runbook (R2 y operación)

Este documento cubre rotacion de credenciales de Cloudflare R2, limpieza del almacenamiento local legacy, verificacion previa a borrar `/uploads`, y roadmap de garbage collection en el bucket.

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

---

## Limpieza del volumen local `/uploads` (post-migracion R2)

Antes de borrar manualmente la carpeta (o el volumen Docker equivalente), conviene **detener el backend** que escribe en ese path (`STORAGE_DRIVER=local` o legado). Con el servicio detenido no deberia haber escritores activos.

### Comando recomendado (Linux / VPS)

Sustituir `/ruta/al/uploads` por el path real (`UPLOAD_PATH` en el host o punto de montaje del volumen):

```bash
# Procesos con archivos abiertos bajo el directorio (requiere lsof)
sudo lsof +D /ruta/al/uploads
```

- Si **no hay salida**, no se reportan descriptores abiertos bajo ese arbol (o no hay permisos para verlos).
- Si aparecen procesos distintos de un explorador puntual, investigar antes de eliminar.

Alternativa compacta:

```bash
sudo fuser -vm /ruta/al/uploads
```

### Contenedor Docker / Coolify

1. Detener o escalar a cero el servicio backend que usa el volumen.
2. Si el volumen esta montado en el host, ejecutar `lsof` / `fuser` sobre la ruta del **host**, no solo dentro del contenedor (las imagenes minimal suelen no incluir `lsof`).
3. Tras backup y validacion en R2, eliminar el contenido del directorio o el volumen segun proceda.

---

## Roadmap: Garbage Collection (objetos huérfanos en R2)

**Problema:** Tras un rollback de base de datos, o un fallo entre subida a R2 y commit transaccional, pueden quedar objetos en el bucket sin fila referenciadora en PostgreSQL.

**Propuesta (fase futura): CronJob o tarea programada administrativa**

1. **Listado:** Usar la API S3 (`ListObjectsV2`) sobre el bucket operativo con el mismo prefijo que usa la app (`R2_KEY_PREFIX` + convencion `tenants/...` si aplica). Paginar por `ContinuationToken`.
2. **Conjunto de referencias en BD:** Construir un `Set` en memoria o tabla temporal con todas las claves referenciadas, normalizadas igual que `StorageService.normalizeStorageKey`:
   - `users.avatar_url`
   - `inventory_item_attachments.storage_key`
   - `purchase_documents.storage_key`
   - `purchase_quotations.attachment_url`
   - `purchase_invoices.pdf_url`
   - `work_orders.responsible_mechanic_signature`, `shift_supervisor_signature` (solo si almacenan rutas de archivo y no datos inline)
   - Cualquier otro campo documentado como puntero a storage
3. **Cruce:** Para cada `Key` del bucket, si no esta en el conjunto (ni variantes `/uploads/...` vs clave relativa), marcar como **candidato huérfano**.
4. **Modo dry-run (obligatorio en v1):** Emitir reporte (CSV/JSON o logs estructurados): `key`, `size`, `lastModified`, `tenantId` inferido del prefijo. Sin borrado automatico.
5. **Modo delete (v2, opt-in):** Parametro explito `--apply` con doble confirmacion o ventana de gracia; limitar a prefijos por tenant; auditar cada `DeleteObject`.
6. **Ejecucion:** Kubernetes CronJob, Coolify scheduled command, o VM con `cron` ejecutando un script Nest/Node con credenciales de solo lectura (dry-run) o lectura+escritura acotada (delete).

**Riesgos:** Claves usadas solo en backups, entornos de staging, o datos aun no migrados pueden parecer huérfanas; por eso el primer entregable debe ser **solo reporte**.

---

## Verificacion de salud de punteros en PostgreSQL

Tras la migracion local a R2, ejecutar en el entorno con `DATABASE_URL` configurado:

```bash
cd backend && npm run storage:verify:db
```

El script falla con codigo distinto de cero si hay filas con claves vacias o solo espacios en columnas criticas (adjuntos de inventario, documentos de compra, etc.).
