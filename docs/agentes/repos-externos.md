# Mapa de repos externos (lo que ya usamos y lo que falta)

Referencia de los repos que te interesaban: qué aportan al **TPM / BL01**, qué quedó integrado en el proyecto y qué seguiría si lo necesitás.

---

## 1. [everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**Qué es:** cientos de skills/agents para harness de IA (Claude Code, Cursor, etc.).

### Ya en este repo (`.cursor/skills/`)

| Skill | Origen ECC | Notas |
|-------|------------|--------|
| `ecc-nestjs-patterns` | `skills/nestjs-patterns` | Nest genérico; manda `tpm-arquitectura.mdc`. |
| `ecc-postgres-patterns` | `skills/postgres-patterns` | Postgres/SQL; Prisma + tenant mandan. |
| `ecc-adr` | `skills/architecture-decision-records` | ADRs en `docs/adr/` (opcional) + notas en `decisiones.md`. |
| `ecc-codebase-onboarding` | `skills/codebase-onboarding` | “Onboarding” del repo; salida hacia `AGENTS.md` / docs. |

### Muy útiles si los copiás después (no están vendados)

| Carpeta `skills/` | Para qué en BL01 |
|-------------------|------------------|
| **`api-design`** | Contratos REST, paginación, errores, versionado — encaja con Nest controllers. |
| **`security-review`** | Checklist al tocar auth, uploads, secretos, endpoints nuevos. |
| **`e2e-testing`** | Patrones **Playwright**; solo si adoptás E2E con Playwright (hoy Angular suele usar Karma/Jasmine o Cypress). |
| **`docker-patterns`** | Refinar `docker-compose`, salud de Postgres, límites. |
| **`deployment-patterns`** | Complemento a `DEPLOY-COOLIFY.md` si ampliás despliegue. |
| **`git-workflow` / `github-ops`** | Commits, PRs, releases en equipo. |
| **`backend-patterns`** | Node/Express/Next — **solapa** con `ecc-nestjs-patterns`; priorizá Nest o api-design. |
| **`frontend-patterns`** | React/Next — **poco alineado** con Angular 18; mejor `ui-ux-pro-max` + reglas TPM UI. |

### Qué no hace falta traer entero

El monorepo completo (agents, hooks, plugins de otras herramientas): ruido y convenciones que no son las vuestras.

---

## 2. [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

**Qué es:** pack de skills bajo `.claude/skills/`.

### Ya en este repo

- **`ui-ux-pro-max`** — copiado a `.cursor/skills/ui-ux-pro-max/` (referencia principal de UX).

### Otros sub-skills en el repo upstream

| Carpeta | Utilidad para BL01 (Angular + tokens TPM) |
|---------|---------------------------------------------|
| **`design-system`** | Tokens en capas, útil como **lectura**; referencia archivos `references/` en upstream — si lo copiás, hay que traer **toda** la carpeta o adaptar enlaces. |
| **`design`**, **`brand`**, **`banner-design`**, **`slides`** | Marketing / presentaciones; baja prioridad para el ERP. |
| **`ui-styling`** | Enfocado en **shadcn/React**; choca con Angular; no recomendado salvo ideas sueltas (accesibilidad). |

**Conclusión:** con **`ui-ux-pro-max`** + **`tpm-arquitectura.mdc` sección 5** tenés la mayor parte; el resto es opcional.

---

## 3. [claude-mem](https://github.com/thedotmack/claude-mem)

**Qué es:** plugin de **Claude Code** (no Cursor) para memoria de sesión comprimida.

### Equivalente en este proyecto

- `AGENTS.md`, `.cursor/rules/`, `docs/agentes/decisiones.md`, skill `ecc-adr` para decisiones fuertes.

**Falta solo hábito:** después de decisiones importantes, una línea en `decisiones.md` o un ADR en `docs/adr/`.

---

## 4. [n8n-mcp](https://github.com/czlonkowski/n8n-mcp)

**Qué es:** servidor **MCP** para que el agente arme/edite flujos en **n8n**.

### En BL01

- **No integrado** (no es código del repo): se configura en **Cursor → MCP** con el servidor que indique el repo n8n-mcp.
- **Tiene sentido** si montás n8n para alertas, webhooks, integraciones ERP↔correo/Sheets/etc.

**Falta:** decisión de producto/ops de usar n8n + añadir MCP en tu máquina (documentar en `docs/agentes/` si lo adoptás).

---

## 5. [LightRAG](https://github.com/hkuds/lightrag)

**Qué es:** framework **Python** de RAG (grafo + recuperación) para productos tipo “chat sobre documentos”.

### En BL01

- **No es herramienta de desarrollo** del día a día: sería un **servicio aparte** (API + índices + coste) si querés IA sobre manuales/políticas internas.

**Falta:** caso de uso claro (qué documentos, quién lo usa, dónde se aloja) antes de tocar código.

---

## Resumen rápido

| Repo | Estado práctico |
|------|------------------|
| everything-claude-code | Cuatro skills ECC en proyecto; **siguiente importación típica:** `api-design`, luego `security-review`. |
| ui-ux-pro-max-skill | Skill principal ya copiado; sub-skills opcionales. |
| claude-mem | Cubierto por docs + reglas + ADR; sin instalar en Cursor. |
| n8n-mcp | Solo si usás n8n + MCP en Cursor. |
| LightRAG | Solo si hay roadmap de RAG en producto. |
