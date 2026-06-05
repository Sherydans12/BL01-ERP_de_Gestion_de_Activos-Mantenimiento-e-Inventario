# Codex project setup

This folder contains Codex-specific project configuration. It is intentionally additive: do not move, delete, or rewrite `.cursor/` files from here.

Sources of truth:

- Repo guidance: `../AGENTS.md`
- Cursor rules: `../.cursor/rules/*.mdc`
- Cursor skills: `../.cursor/skills/*/SKILL.md`
- Codex skill wrappers: `../.agents/skills/*/SKILL.md`

Hooks are not enabled here yet. Cursor hooks remain in `../.cursor/hooks.json`; if Codex hooks are added later, document the mapping in `../docs/agentes/codex-compatibilidad.md` first.
