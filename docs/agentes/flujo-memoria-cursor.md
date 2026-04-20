# Replicar la idea de claude-mem en Cursor (BL01)

[claude-mem](https://github.com/thedotmack/claude-mem) en **Claude Code** hace tres cosas automáticas: **registrar** lo que pasó en la sesión, **comprimir** con un modelo, y **inyectar** fragmentos relevantes al abrir otra sesión.

En **Cursor** no existe el mismo plugin. Lo que sí podés replicar es el **resultado útil**: que el próximo chat tenga **contexto fiel al proyecto** sin depender del historial.

---

## ¿Lo mismo hoy?

| claude-mem | Este repo (BL01) ahora |
|------------|-------------------------|
| Captura automática de la sesión | **No.** Nadie graba cada turno solo por abrir Cursor. |
| Compresión con IA de sesiones largas | **No automático.** Podés pedir al agente un resumen y guardarlo vos. |
| Inyección en el siguiente chat | **Parcial:** las reglas `.cursor/rules/*.mdc` y `AGENTS.md` entran en contexto según Cursor; **no** sustituyen un “resumen de ayer” salvo que esté escrito en `docs/agentes/`. |
| Memoria estable en git | **Sí** — `AGENTS.md`, `decisiones.md`, `glosario.md`, ADRs (`ecc-adr`), skills ECC. |

**Conclusión:** replicamos la **intención** (memoria de equipo y del producto), no el **pipeline automático** de claude-mem.

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

## Opcional: acercarse a la “captura” automática

- **Hooks de Cursor** (evento al terminar comando o agente): podrían appendear un timestamp a `docs/agentes/sesiones.log.md`. Eso **no** comprime con IA; solo deja rastro. Configuración fuera de este repo (Cursor → Hooks).
- **Memoria de Cursor** (preferencias del usuario): útil para *vos*, no reemplaza `decisiones.md` para el equipo.

Si más adelante Anthropic u otra herramienta ofrece claude-mem o similar **dentro de Cursor**, se puede sumar sin tocar la lógica del ERP: este flujo sigue siendo la capa en **git**.
