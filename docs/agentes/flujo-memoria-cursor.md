# Replicar la idea de claude-mem en Cursor (BL01)

[claude-mem](https://github.com/thedotmack/claude-mem) en **Claude Code** hace tres cosas automáticas: **registrar** lo que pasó en la sesión, **comprimir** con un modelo, y **inyectar** fragmentos relevantes al abrir otra sesión.

En **Cursor** no existe el mismo plugin. Lo que sí podés replicar es el **resultado útil**: que el próximo chat tenga **contexto fiel al proyecto** sin depender del historial.

---

## ¿Lo mismo hoy?

| claude-mem | Este repo (BL01) ahora |
|------------|-------------------------|
| Captura automática de la sesión | **Parcial (local):** hook `afterAgentResponse` + `sessionEnd` appendean JSONL en `docs/agentes/sesiones-auto.log.md` (no va a git; ver `sesiones-auto.README.md`). |
| Compresión con IA de sesiones largas | **No en background.** Podés pedir al agente un resumen y guardarlo en `decisiones.md`. |
| Inyección en el siguiente chat | **Sí (local + equipo):** hook `sessionStart` inyecta `additional_context` con colas de `decisiones.md`, `glosario.md` y el log local; además reglas `.cursor/rules/*.mdc` y `AGENTS.md`. |
| Memoria estable en git | **Sí** — `AGENTS.md`, `decisiones.md`, `glosario.md`, ADRs (`ecc-adr`), skills ECC. |

**Conclusión:** replicamos **captura + inyección** en cada máquina con hooks; la **compresión semántica** tipo claude-mem sigue siendo manual (prompts de abajo) o futura integración externa.

---

## Ritual mínimo (manual, 2–5 min)

Después de una sesión donde cambió algo importante:

1. **Commit** del código (la verdad sigue siendo el diff).
2. Abrí **`docs/agentes/decisiones.md`** y añadí una entrada corta (fecha + qué + por qué), o usá el bloque de abajo para dictárselo al agente.
3. Si fue **arquitectura** grande, valorá un ADR con el skill **`ecc-adr`** (carpeta `docs/adr/` solo si el equipo lo adopta).
4. Actualizá **`docs/agentes/glosario.md`** si apareció jargon nuevo.
5. En el **próximo chat**, con un mensaje alcanza: *“Leé AGENTS.md y lo último en docs/agentes/decisiones.md”* (o @ esos archivos).

Eso es lo más cercano a “inyectar contexto” sin claude-mem.

---

## Prompts para pegar en Cursor (sustituyen la compresión con IA)

**A) Fin de sesión — volcar en `decisiones.md`**

```text
Resumí en 5–10 líneas lo que hicimos en esta sesión (decisiones, archivos tocados, riesgos).
Formato: fecha ISO, viñetas, sin código largo. Propuesta para append a docs/agentes/decisiones.md.
No commitees; yo reviso y guardo.
```

**B) Abrir chat nuevo — cargar memoria**

```text
Antes de proponer cambios: leé AGENTS.md, docs/agentes/decisiones.md y docs/agentes/glosario.md.
Respetá .cursor/rules/tpm-arquitectura.mdc.
```

**C) Solo decisiones de API / seguridad**

```text
Alineá esta tarea con ecc-api-design y ecc-security-review además de tpm-arquitectura.mdc.
```

---

## Automatización con hooks (incluida en el repo)

Archivos: **`.cursor/hooks.json`** y **`.cursor/hooks/mem-*.mjs`**.

| Evento | Qué hace |
|--------|-----------|
| `sessionStart` | Devuelve `additional_context` con extractos de `decisiones.md`, `glosario.md` y `sesiones-auto.log.md`. |
| `afterAgentResponse` | Appendea una línea JSON (timestamp, tamaño, preview del mensaje del asistente). Rota el archivo si supera ~200 KB. |
| `sessionEnd` | Appendea metadatos de cierre (`session_id`, `reason`, `duration_ms`, …). |

**Requisitos:** `node` disponible en el PATH del proceso de Cursor (normal en este proyecto). Si los hooks no aparecen, reiniciá Cursor y revisá la pestaña **Hooks** / el canal de salida **Hooks**.

**Memoria compartida entre devs:** seguí usando **`decisiones.md`** con commits; el log automático es **por máquina** (gitignored).

**Memoria de Cursor** (preferencias del usuario): útil para *vos*, no reemplaza `decisiones.md` para el equipo.
