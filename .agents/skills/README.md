# Codex skill wrappers

Codex discovers repository skills from `.agents/skills`. This repo already maintains Cursor skills under `.cursor/skills`, so the folders here are lightweight wrappers only.

Rules:

- Keep canonical skill instructions in `.cursor/skills/<name>/SKILL.md`.
- Keep wrapper `name` and `description` aligned with the Cursor skill.
- Do not duplicate full skill bodies here unless the Codex workflow genuinely diverges.
- If a Cursor skill is renamed, update the matching wrapper path and this index.

Current wrappers:

- `ecc-adr`
- `ecc-api-design`
- `ecc-codebase-onboarding`
- `ecc-nestjs-patterns`
- `ecc-postgres-patterns`
- `ecc-security-review`
- `tpm-contexto-proyecto`
- `ui-ux-pro-max`
