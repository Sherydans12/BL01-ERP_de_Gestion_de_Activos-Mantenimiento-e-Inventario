# Guía para agentes (Cursor) — TPM / BL01 ERP

Este archivo es el **índice principal** de contexto del repositorio. Léelo al empezar tareas que toquen arquitectura, dominio o convenciones del equipo.

## Qué es el sistema

**TPM — Gestión de activos y EAM** para entornos industriales: flota, mantenimiento (preventivo/correctivo), inventario multibodega, kardex inmutable, valorización **CPP** (costo promedio ponderado), multi-tenant por empresa y segregación por contratos/faenas.

Fase actual descrita en el README raíz: **D — Hardening y lógica EAM**.

## Reglas del asistente (Cursor)

- **Arquitectura y estilo de código:** `.cursor/rules/tpm-arquitectura.mdc` (siempre activa).
- **Contexto e índice de docs:** `.cursor/rules/erp-bl01-context.mdc` (siempre activa).
- **Stub legacy:** `.agents/rules/tpm-arquitectura.md` solo apunta al `.mdc`; editar siempre el `.mdc`.

## Stack

| Área | Tecnología |
|------|------------|
| Frontend | Angular 18 (`frontend/`) |
| Backend | NestJS 11 (`backend/`) |
| Datos | PostgreSQL 16, Prisma |

## Dónde está cada cosa

- **Raíz:** [README.md](README.md) — visión, instalación local, principios de datos.
- **Despliegue:** [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md) — Coolify / producción.
- **Backend:** `backend/src/features/` — módulos por dominio (auth, equipments, inventory-items, etc.).
- **Esquema DB:** `backend/prisma/schema.prisma`.
- **Frontend:** `frontend/src/app/` — rutas y componentes de la aplicación.

## Reglas de dominio (resumen)

- Aislamiento por **`tenantId`** y contratos/faenas según modelo actual.
- Consumo de stock **atómico** en flujos críticos (p. ej. cierre de OT); revisar servicios que usan `$transaction`.
- No asumir APIs nuevas sin alinear con DTOs y guards existentes (JWT, roles).

## Documentación viva para el equipo y los agentes

Mantén acuerdos, glosario de negocio y notas de sesión en:

**[`docs/agentes/`](docs/agentes/README.md)**

Convención sugerida:

- `docs/agentes/README.md` — índice y enlaces.
- `docs/agentes/decisiones.md` — decisiones de diseño breves (fecha + contexto + decisión).
- `docs/agentes/glosario.md` — términos TPM/EAM internos.

Actualiza estos archivos cuando cambie el modelo mental del producto; así los chats nuevos recuperan contexto sin depender solo del historial.

## Herramientas externas (solo desarrollo)

Instrucciones para **ui-ux-pro-max-skill**, **everything-claude-code** y el equivalente a **claude-mem** en Cursor están en [`docs/agentes/README.md`](docs/agentes/README.md).

## Idioma

La documentación orientada al equipo puede estar en **español**. Código y nombres técnicos siguen las convenciones ya presentes en el repo (inglés en identificadores donde ya se usa).
