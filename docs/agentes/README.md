# Documentación para agentes y proceso de desarrollo

Esta carpeta es el **repositorio de contexto** que Cursor y los agentes deben usar además de `AGENTS.md` en la raíz. Cuanto más mantengáis estos archivos, más estables serán los chats nuevos.

**Mapa de repos externos** (claude-mem, ui-ux, n8n-mcp, LightRAG, everything-claude-code): [repos-externos.md](repos-externos.md).

## Equivalente a claude-mem en Cursor

[claude-mem](https://github.com/thedotmack/claude-mem) es de **Claude Code**; en Cursor **no** hay el mismo pipeline automático (capturar → comprimir → inyectar). Sí podés replicar el **objetivo** con reglas + docs en git y un ritual corto.

**Guía detallada (paridad, ritual, prompts, hooks):** [flujo-memoria-cursor.md](flujo-memoria-cursor.md).

**Hooks automáticos:** `.cursor/hooks.json` + `.cursor/hooks/mem-*.mjs` — al abrir un chat se inyectan extractos; tras cada respuesta del agente y al cerrar la sesión se escribe `sesiones-auto.log.md` (local, gitignored; ver [sesiones-auto.README.md](sesiones-auto.README.md)).

Resumen: **`AGENTS.md`**, **`.cursor/rules/`**, **`docs/agentes/`** (`decisiones.md`, `glosario.md`), **@archivos** en chats críticos, y **Memoria de Cursor** solo para preferencias personales (no sustituye la doc del equipo).

## ui-ux-pro-max-skill

Repositorio upstream: [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).

**En este proyecto ya está copiado** en `.cursor/skills/ui-ux-pro-max/` (vía `.claude/skills/ui-ux-pro-max` del repo oficial). Las reglas **tpm-arquitectura** indican al agente que no contradiga los tokens TPM al usar ese skill.

**Actualizar la copia** (cuando quieras la última versión upstream):

```powershell
cd <raíz-del-repo>
Remove-Item -Recurse -Force temp-ui-ux-pro-max-skill -ErrorAction SilentlyContinue
git clone --depth 1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git temp-ui-ux-pro-max-skill
Copy-Item temp-ui-ux-pro-max-skill\.claude\skills\ui-ux-pro-max .cursor\skills\ui-ux-pro-max -Recurse -Force
Remove-Item -Recurse -Force temp-ui-ux-pro-max-skill
```

**Opcional — copia personal en tu usuario:** duplicá la misma carpeta a `%USERPROFILE%\.cursor\skills\ui-ux-pro-max\` para otros repos.

Cursor descubre skills por el `description` del frontmatter de `SKILL.md`. Para UI en Angular, podés pedir en el chat que aplique el skill **ui-ux-pro-max**.

## everything-claude-code

Repositorio: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code).

Es un **ecosistema grande** (plugins/agents/skills orientados a varios harness). En Cursor no instaláis el plugin de Claude Code tal cual; lo útil es **extraer piezas**.

### Ya integrado en este repo (adaptado a BL01)

| Skill en `.cursor/skills/` | Origen ECC | Uso |
|---------------------------|------------|-----|
| `ecc-nestjs-patterns` | `skills/nestjs-patterns` | Nest genérico; **no** pisa `tpm-arquitectura.mdc` ni `src/features/`. |
| `ecc-postgres-patterns` | `skills/postgres-patterns` (basada en Supabase) | Índices, SQL, tuning; Prisma + tenant siguen mandando. |
| `ecc-adr` | `skills/architecture-decision-records` | ADRs opcionales en `docs/adr/`; notas ligeras en `decisiones.md`. |
| `ecc-codebase-onboarding` | `skills/codebase-onboarding` | Onboarding del repo; salida preferida hacia `AGENTS.md`. |
| `ecc-api-design` | `skills/api-design` | Diseño REST para Nest; usar junto a `ecc-security-review`. |
| `ecc-security-review` | `skills/security-review` | Revisión seguridad en auth, APIs, uploads, secretos. |

`tpm-arquitectura.mdc` sección 8 enlaza estos skills. Prioridad de **siguientes imports** sugeridos: [repos-externos.md](repos-externos.md#1-everything-claude-code).

### Añadir más skills ECC

1. Clonar en carpeta temporal (no commitear el clon): `git clone --depth 1 https://github.com/affaan-m/everything-claude-code.git temp-everything-claude-code` (está en `.gitignore`).
2. Elegir carpeta bajo `skills/<nombre>/SKILL.md`.
3. Copiar a `.cursor/skills/ecc-<nombre>/SKILL.md`, añadir preámbulo BL01 (prioridad vs `tpm-arquitectura.mdc`) y ajustar `name` / `description` del frontmatter.

Evitá copiar todo el monorepo al proyecto: ruido y conflictos de convenciones.

## Archivos sugeridos en esta carpeta

| Archivo | Uso |
|---------|-----|
| `README.md` | Este índice |
| `decisiones.md` | ADRs ligeras (opcional, creado cuando queráis) |
| `glosario.md` | Términos de negocio TPM (opcional) |

Podéis añadir `integraciones.md`, `errores-conocidos.md`, etc., según necesidad.
