# Documentación para agentes y proceso de desarrollo

Esta carpeta es el **repositorio de contexto** que Cursor y los agentes deben usar además de `AGENTS.md` en la raíz. Cuanto más mantengáis estos archivos, más estables serán los chats nuevos.

## Equivalente a claude-mem en Cursor

[claude-mem](https://github.com/thedotmack/claude-mem) está pensado para **Claude Code**, no para Cursor.

En Cursor podéis lograr el mismo objetivo (“memoria de proyecto”) con:

1. **`AGENTS.md`** (raíz) — índice siempre visible para el agente si lo referenciáis o si tenéis reglas que lo citan.
2. **`.cursor/rules/`** — reglas del proyecto (ya incluida una regla que apunta aquí).
3. **Esta carpeta `docs/agentes/`** — decisiones, glosario, notas de integración.
4. **Memoria de Cursor** (funciones del producto) — para preferencias globales vuestro; no sustituye la documentación en git.
5. **@Archivos en el chat** — adjuntar `AGENTS.md` o un doc concreto cuando el contexto sea crítico.

Recomendación: tras decisiones importantes en un chat, **copiar un párrafo a `decisiones.md`** antes de cerrar.

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

Es un **ecosistema grande** (plugins/agents/skills orientados a varios harness). En Cursor no instaláis el plugin de Claude Code tal cual; lo útil es **extraer piezas**:

- Reglas o fragmentos que encajen con **NestJS** / seguridad / tests → adaptarlos a `.cursor/rules/*.mdc` propias (concisas).
- Skills concretos → copiar solo los que necesitéis a `.cursor/skills/<nombre>/` y revisar que no asuman comandos exclusivos de Claude Code.

**Siguiente paso sugerido (cuando tengas tiempo):** clonar ese repo en una carpeta temporal, buscar en `skills/` términos como `nestjs`, `prisma`, `security` o `tdd`, leer 1–2 skills que encajen con BL01 y copiar solo esos `SKILL.md` (y referencias relativas) a `.cursor/skills/<nombre>/`, ajustando el frontmatter `description` si hace falta.

Evitá copiar todo el monorepo al proyecto: ruido y conflictos de convenciones.

## Archivos sugeridos en esta carpeta

| Archivo | Uso |
|---------|-----|
| `README.md` | Este índice |
| `decisiones.md` | ADRs ligeras (opcional, creado cuando queráis) |
| `glosario.md` | Términos de negocio TPM (opcional) |

Podéis añadir `integraciones.md`, `errores-conocidos.md`, etc., según necesidad.
