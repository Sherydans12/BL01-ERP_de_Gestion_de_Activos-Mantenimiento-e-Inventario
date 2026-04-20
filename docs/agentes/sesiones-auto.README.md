# `sesiones-auto.log.md` (generado por hooks de Cursor)

Este archivo **no se commitea** (está en `.gitignore`). Lo crean los hooks del proyecto:

- **Fin de cada respuesta del agente** (`afterAgentResponse`): una línea JSON con timestamp, tamaño del texto y un preview corto.
- **Cierre de conversación** (`sessionEnd`): una línea JSON con `session_id`, `reason`, `duration_ms`, etc.

Al **abrir un chat nuevo**, el hook `sessionStart` inyecta en contexto los **últimos caracteres** de:

- `decisiones.md`, `glosario.md` (sí van en git),
- y este log local (solo tu máquina).

## Memoria compartida en el equipo

Para que otros vean decisiones, usá **`decisiones.md`** y commits. El log automático es **ayuda local** (similar a la parte “captura” de claude-mem en una sola workstation).
