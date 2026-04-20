---
name: tpm-contexto-proyecto
description: >-
  Al implementar o refactorizar el ERP TPM (NestJS, Prisma, Angular): usar AGENTS.md,
  docs/agentes/ y README del repo para alinear dominio EAM/inventario/tenancy antes
  de proponer arquitectura o APIs nuevas.
---

# Contexto TPM / BL01 ERP

## Cuándo aplicar

- Cambios que cruzan varios módulos en `backend/src/features/`.
- Nuevas entidades Prisma o flujos de inventario / OT / activos.
- Pantallas Angular que reflejan reglas de negocio (no solo estilo).

## Pasos

1. Leer `AGENTS.md` en la raíz del repositorio.
2. Revisar `docs/agentes/README.md` y, si existen, `decisiones.md` o `glosario.md` en la misma carpeta.
3. Confirmar supuestos contra `README.md` (raíz) y el `schema.prisma` relevante.
4. Mantener consistencia con guards JWT, roles y patrones de transacción ya usados en el feature más cercano.

## UI/UX

Si el usuario pide calidad visual o patrones de producto, usar el skill del repo **`.cursor/skills/ui-ux-pro-max/`** (no contradecir tokens TPM en `tpm-arquitectura.mdc`). Si la tarea es solo coherencia con pantallas existentes, seguir componentes en `frontend/src/app/`.
