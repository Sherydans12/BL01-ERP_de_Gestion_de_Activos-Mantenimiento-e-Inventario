# Compatibilidad Codex + Cursor

Fecha: 2026-06-05

Objetivo: permitir trabajar desde Codex sin perder ni reemplazar el entorno Cursor existente.

## Principios

- `.cursor/` sigue siendo la fuente operativa para Cursor: reglas, skills y hooks.
- `AGENTS.md` es el contrato comun del repo para agentes.
- `.codex/` contiene solo configuracion especifica de Codex.
- `.agents/skills/` contiene wrappers de Codex que delegan a `.cursor/skills/`.
- `docs/agentes/` sigue siendo la memoria viva compartida.

## Mapeo actual

| Necesidad | Cursor | Codex |
|-----------|--------|-------|
| Instrucciones repo | `.cursor/rules/*.mdc` + `AGENTS.md` | `AGENTS.md` |
| Config del agente | `.cursor/` | `.codex/config.toml` |
| Skills | `.cursor/skills/*/SKILL.md` | `.agents/skills/*/SKILL.md` wrappers |
| Hooks/memoria automatica | `.cursor/hooks.json` + `.cursor/hooks/*.mjs` | No habilitado aun en proyecto |
| Memoria/documentacion viva | `docs/agentes/` | `docs/agentes/` |

## Como mantenerlo

1. Si cambias una regla de arquitectura o UI, edita `.cursor/rules/tpm-arquitectura.mdc` y verifica que `AGENTS.md` siga apuntando al lugar correcto.
2. Si cambias una skill Cursor, conserva el wrapper en `.agents/skills/<skill>/SKILL.md` apuntando a la misma ruta.
3. Si agregas una nueva skill de proyecto en `.cursor/skills/`, crea su wrapper equivalente en `.agents/skills/`.
4. No copies el contenido completo de las skills a `.agents/skills/` salvo que Codex necesite una variante real.
5. Antes de agregar hooks Codex, documenta aqui el evento, script, entradas esperadas y diferencia con los hooks Cursor.

## Pendiente deliberado

No se migraron los hooks Cursor a Codex. Los hooks Codex usan otra forma de eventos y requieren revision/confianza desde Codex; activarlos sin validar podria duplicar logs o producir automatizaciones inesperadas.
