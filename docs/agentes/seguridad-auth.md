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

## Local y entornos de desarrollo

| Mecanismo | Efecto |
|-----------|--------|
| IP local/privada en el cliente | No se evalúa el paso 2 aunque la política esté on (evita bloqueos con geo vacío o sin historial en localhost). |
| `AUTH_STEP_UP_BYPASS=true` en `.env` | Desactiva el flujo 2FA por env **sin** cambiar la base; la API expone el flag en `GET /api/admin/security/global-auth-settings` como `authStepUpLocalBypass` y en `GET /api/users/me` dentro de `security.localDevelopmentBypass`. Recomendado anotar en `backend/.env` local, **no** en producción. |

**Extensión a otros roles:** añadir el rol a `USER_ROLES_WITH_EMAIL_STEP_UP` e implementar la rama en `AuthAuditService.shouldRequireEmailContextStepUp` (hoy la lógica de IP/país vive en `shouldRequireSuperAdminLocationStepUp`).

## API relevante

| Método | Ruta | Notas |
|--------|------|--------|
| POST | `/api/auth/login` | Puede devolver `stepUpRequired` + `stepUpToken` en lugar de `access_token`. |
| POST | `/api/auth/login/super-admin-step-up` | Valida el código; emite JWT. |
| GET | `/api/users/me` | Incluye `security`: política, bypass local y si aplica al rol actual. |
| GET | `/api/users` (paginado) | Cada ítem: `emailStepUpPolicyApplies` (rol + política + sin bypass). |
| GET/PATCH | `/api/admin/security/global-auth-settings` | Lectura ADMIN+; solo SUPER_ADMIN modifica. |

## Migraciones

Al añadir carpetas bajo `backend/prisma/migrations/`, aplicar en local (ver regla en `.cursor/rules/erp-bl01-context.mdc`). En producción, Coolify ejecuta el deploy con `prisma migrate deploy` según el flujo del equipo.

## Referencia de archivos

- Política y extensión de roles: `step-up-policy.service.ts`
- Código de reto y correo: `login-step-up.service.ts`, `auth.service.ts`
- Listado/“Mi cuenta”: `users.service.ts` (`getMe`, `findAll`)
