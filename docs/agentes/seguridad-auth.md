# Seguridad de autenticación (TPM / BL01)

Registro de políticas y flujos que afectan login, sesión y factores adicionales. Complementa `ecc-security-review` y `tpm-arquitectura` (anti-enumeración, tenant/site, auditoría de auth).

## Verificación adicional por correo (2FA “contextual”)

**Alcance actual:** roles listados en `USER_ROLES_WITH_EMAIL_STEP_UP` en `backend/src/features/auth/step-up-policy.service.ts` (hoy solo `SUPER_ADMIN`).

**Cuándo se pide un código de 6 dígitos** tras contraseña correcta:

- Política global **activa** en `platform_security_settings.super_admin_step_up_email_enabled` (UI: **Seguridad global** → Políticas).
- El servidor **no** tiene `AUTH_STEP_UP_BYPASS=true`.
- La IP del cliente **no** es local/privada (en `127.0.0.1` / `::1` / RFC1918, etc. el requisito de “contexto inusual” no se aplica, útil en desarrollo).
- Y el contexto de red se considera poco habitual: sin historial previo, IP o país distintos al último login exitoso, o IP aún poco “consolidada” en el historial reciente (ver `AuthAuditService.shouldRequireSuperAdminLocationStepUp`).

**No es TOTP móvil:** el código se envía por el `EmailService` (plantilla `buildMailSuperAdminStepUp` en `transactional-mail.builder.ts`).

## TOTP (aplicación autenticadora, RFC 6238)

**Alcance actual:** solo `SUPER_ADMIN` (mismo criterio de producto que el enrolamiento en **Mi cuenta** y la visibilidad en listados / **Seguridad global**).

**Orden en el login** (tras contraseña correcta y limpiar `lockout`):

1. Si el usuario tiene `users.totp_enabled` y rol Super Admin → el API responde `totpRequired` + `preAuthToken` (JWT corto, `typ: 'pre_totp'`, ~5 min). No se emite sesión todavía.
2. El cliente llama `POST /api/auth/login/verify-totp` con `preAuthToken` y `totpCode`.
3. Tras TOTP válido, se aplica la **misma** lógica de 2FA por correo que en un login “normal” (contexto poco habitual): si aplica, respuesta `stepUpRequired` + `stepUpToken`; si no, sesión completa (`access_token` + `user`).

**Enrolamiento / baja (perfil):** `POST /api/users/me/totp/begin` (genera secreto cifrado en `totp_secret_encrypted`, QR + clave manual), `.../activate` (confirma con 6 dígitos), `.../disable` (contraseña + código TOTP actual, invalida sesiones). Ver `users.service.ts` y `totp.service.ts`.

**Cifrado del secreto en BD:** AES-256-GCM (`totp-secret-crypto.ts`); clave vía `TOTP_ENCRYPTION_KEY` (mín. 16 caracteres en producción) o, si no está definida, material derivado de `JWT_SECRET` (menos deseable; documentado en `backend/.env.example`).

## Escalabilidad futura (TOTP y 2FA)

| Objetivo | Dónde tocar |
|----------|-------------|
| **Otro rol con TOTP** | Ajustar comprobaciones en `users.service.ts` (`beginTotpEnrollment`, `activateTotp`, `disableTotp`) y en `auth.service.ts` (rama `user.totpEnabled` del `login` y `verifyTotpLogin`); alinear `getSecuritySnapshotForUserRole` en `step-up-policy.service.ts` (`totpEnrollable` / filtrado por rol). Opcional: constante `USER_ROLES_WITH_TOTP` análoga a `USER_ROLES_WITH_EMAIL_STEP_UP`. |
| **Política “TOTP obligatorio” por tenant o plataforma** | Nuevo flag en `platform_security_settings` o en `tenants` + validación en `login` (rechazar login sin TOTP si la política lo exige) y UI en **Seguridad global** o ajustes de empresa. |
| **Recuperación si pierde el teléfono** | Hoy: flujo admin (p. ej. `set-password` / soporte) o desactivar TOTP con credenciales; se puede añadir códigos de respaldo o flujo de verificación por correo solo en ese caso. |
| **WebAuthn / passkeys** | Módulo aparte; no reutiliza columnas TOTP; mantener TOTP y WebAuthn como factores disjuntos en diseño. |

Mantener **transacciones** y **invalidación de sesiones** al desactivar factores, como en `disableTotp`.

## Local y entornos de desarrollo

| Mecanismo | Efecto |
|-----------|--------|
| IP local/privada en el cliente | No se evalúa el paso 2 aunque la política esté on (evita bloqueos con geo vacío o sin historial en localhost). |
| `AUTH_STEP_UP_BYPASS=true` en `.env` | Desactiva el flujo 2FA por env **sin** cambiar la base; la API expone el flag en `GET /api/admin/security/global-auth-settings` como `authStepUpLocalBypass` y en `GET /api/users/me` dentro de `security.localDevelopmentBypass`. Recomendado anotar en `backend/.env` local, **no** en producción. |

**Extensión a otros roles:** añadir el rol a `USER_ROLES_WITH_EMAIL_STEP_UP` e implementar la rama en `AuthAuditService.shouldRequireEmailContextStepUp` (hoy la lógica de IP/país vive en `shouldRequireSuperAdminLocationStepUp`).

## API relevante

| Método | Ruta | Notas |
|--------|------|--------|
| POST | `/api/auth/login` | Puede devolver `totpRequired` + `preAuthToken`, o `stepUpRequired` + `stepUpToken`, o `access_token`. |
| POST | `/api/auth/login/verify-totp` | Tras `totpRequired`; luego puede devolver `stepUpRequired` o sesión completa. |
| POST | `/api/auth/login/super-admin-step-up` | Valida el código de correo; emite JWT. |
| POST | `/api/users/me/totp/begin` \| `.../activate` \| `.../disable` | TOTP solo Super Admin (ver servicio). |
| GET | `/api/users/me` | Incluye `security`: política, bypass local, `totpEnrollable` / `totpEnabled`, etc. |
| GET | `/api/users` (paginado) | Cada ítem: `emailStepUpPolicyApplies`, `totpEnabled` (y columnas de siempre). |
| GET/PATCH | `/api/admin/security/global-auth-settings` | Lectura ADMIN+; solo SUPER_ADMIN modifica. Incluye `superAdminTotpEnabledCount` y `superAdminCount`. |

## Migraciones

Al añadir carpetas bajo `backend/prisma/migrations/`, aplicar en local (ver regla en `.cursor/rules/erp-bl01-context.mdc`). En producción, Coolify ejecuta el deploy con `prisma migrate deploy` según el flujo del equipo.

## Referencia de archivos

- Política y extensión de roles: `step-up-policy.service.ts`
- Código de reto y correo: `login-step-up.service.ts`, `auth.service.ts`
- Listado/“Mi cuenta”: `users.service.ts` (`getMe`, `findAll`)
