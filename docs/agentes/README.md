# Documentación para agentes y proceso de desarrollo

Esta carpeta es el **repositorio de contexto** que Cursor y los agentes deben usar además de `AGENTS.md` en la raíz. Cuanto más mantengáis estos archivos, más estables serán los chats nuevos.

**Arquitectura y dominio (documento maestro):** [../MASTER-CONTEXT.md](../MASTER-CONTEXT.md) — entidades Prisma, módulos NestJS, rutas Angular, PBAC y flujos transaccionales (OT, kardex, compras 3-way). Incluye tabla de **fuentes canónicas** a revisar cuando cambie el código; actualizar la fecha del doc al sincronizar.

**PBAC — matriz de verificación:** [pbac-matriz-verificacion.md](pbac-matriz-verificacion.md) (personas de prueba, fases 0–3, checklist E2E).

**Integración del sistema completo (roadmap):** [sistema-integrado-roadmap.md](sistema-integrado-roadmap.md) — plan para que todos los módulos (Flota, OT, M1/M2/M3, Inventario, Compras) se vean y operen como un único sistema; sprints priorizados, criterio de "completitud" y guía de trabajo entre módulos.

**M2 Disponibilidad — tablero del turno (implementación):** [m2-disponibilidad-plan-implementacion.md](m2-disponibilidad-plan-implementacion.md) — monitor, formulario paginado, historial, APIs `shift-board` / `batch`.

**Compras PBAC — pruebas API/E2E:** [compras-pbac-pruebas-api-e2e.md](compras-pbac-pruebas-api-e2e.md) (seed 13 personas, `simulate:compras-pbac`, Playwright `e2e/`).  
**Inventario PBAC — pruebas API/E2E:** [inventario-pbac-pruebas-api-e2e.md](inventario-pbac-pruebas-api-e2e.md) (seed 8 personas, `simulate:inventario-pbac`, Playwright `e2e/tests/inventario/`).  
**Maestros Excel BaseLogic — export/import:** [importacion-exportacion-maestros-excel.md](importacion-exportacion-maestros-excel.md) — flota e inventario, contrato oculto, validacion previa, requisitos bloqueantes y politica de bajas con historial.
**Operaciones × Inventario — E2E cobertura y pendientes:** [operaciones-e2e-cobertura-y-pendientes.md](operaciones-e2e-cobertura-y-pendientes.md) (ciclo M1/W2W/OT, caos/resiliencia, puntos ciegos y specs P0–P3).

**Mapa de repos externos** (claude-mem, ui-ux, n8n-mcp, LightRAG, everything-claude-code): [repos-externos.md](repos-externos.md).

## Equivalente a claude-mem en Cursor

[claude-mem](https://github.com/thedotmack/claude-mem) es de **Claude Code**; en Cursor **no** hay el mismo pipeline automático (capturar → comprimir → inyectar). Sí podés replicar el **objetivo** con reglas + docs en git y un ritual corto.

**Guía detallada (paridad, ritual, prompts, hooks):** [flujo-memoria-cursor.md](flujo-memoria-cursor.md).

**Hooks automáticos:** `.cursor/hooks.json` + `.cursor/hooks/mem-*.mjs` — al abrir un chat se inyectan extractos; tras cada respuesta del agente y al cerrar la sesión se escribe `sesiones-auto.log.md` (local, gitignored; ver [sesiones-auto.README.md](sesiones-auto.README.md)).

Resumen: **`AGENTS.md`**, **`.cursor/rules/`**, **`docs/agentes/`** (`decisiones.md`, `glosario.md`), **@archivos** en chats críticos, y **Memoria de Cursor** solo para preferencias personales (no sustituye la doc del equipo).

## Compatibilidad Codex

Guia: [codex-compatibilidad.md](codex-compatibilidad.md).

Codex debe usar `AGENTS.md` como entrada principal. Las skills repo-locales viven en `.agents/skills/` como wrappers que delegan a `.cursor/skills/`, para no mantener dos copias divergentes. La configuracion especifica de Codex vive en `.codex/config.toml`. Los hooks Cursor no fueron migrados automaticamente a Codex; si se agregan hooks Codex, documentar primero el mapeo en la guia.

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
| [platform-data-admin.md](platform-data-admin.md) | Herramienta SUPER_ADMIN: purga por tenant, API `/api/super-admin/platform`, escalamiento |
| [seguridad-auth.md](seguridad-auth.md) | 2FA por correo (Super Admin), TOTP (Super Admin), bypass local, API y notas de extensión |
| [remediacion-docker-trivy-coolify.md](remediacion-docker-trivy-coolify.md) | Docker: usuario no root, healthchecks, frontend puerto **8080** interno y checklist **Coolify** |
| [correos-transaccionales.md](correos-transaccionales.md) | Plantillas, `npm run email-previews`, reglas técnicas; el **inventario de envíos** vive en [CORREOS-SISTEMA.md](../CORREOS-SISTEMA.md) |
| [notificaciones-sistema.md](notificaciones-sistema.md) | **Web Push** (VAPID, suscripción, payloads `data.type`), inventario de envíos activos y checklist al añadir nuevas notificaciones |
| [../CORREOS-SISTEMA.md](../CORREOS-SISTEMA.md) | **Catálogo maestro** de todos los `sendMail` y plantillas; actualizar al añadir correos nuevos |
| [../PURCHASE-FLOWS.md](../PURCHASE-FLOWS.md) y [../PURCHASE-GOVERNANCE.md](../PURCHASE-GOVERNANCE.md) | **Compras:** flujos SRC → OC → recepción (cantidades, catálogo por línea, generación OC) y matriz de firmas ACL / `minAmount` |
| [compras-pbac-pruebas-api-e2e.md](compras-pbac-pruebas-api-e2e.md) | **Compras PBAC:** seed personas, simulador API (`simulate:compras-pbac`), Playwright E2E menú Compras |
| [inventario-pbac-pruebas-api-e2e.md](inventario-pbac-pruebas-api-e2e.md) | **Inventario PBAC:** seed 8 personas, `simulate:inventario-pbac`, Playwright E2E catálogo/W2W/stock/ghost forms |
| `decisiones.md` | ADRs ligeras (opcional, creado cuando queráis) |
| `glosario.md` | Términos de negocio TPM (opcional) |
| [pdf-html-playwright-plantilla-base.md](pdf-html-playwright-plantilla-base.md) | **PDF backend:** plantilla base HTML + Playwright (A4, estilos, seguridad); OC como referencia |
| [prisma-client-y-migraciones.md](prisma-client-y-migraciones.md) | **Prisma:** `postinstall` / `prebuild` → `generate`; cuándo correr `migrate deploy`; Docker y dev local |
| [inventario-stock-transferencias-kardex.md](inventario-stock-transferencias-kardex.md) | **Inventario:** maestro de artículos, `ItemStock`, kardex (`InventoryTransaction`), ajustes, transferencias W2W, picker y rutas de código |
| [inventario-alta-articulos-y-selector-global.md](inventario-alta-articulos-y-selector-global.md) | **Inventario:** política de umbrales sin `item_stocks` hasta primer movimiento; alta `/articulos/nuevo`; selector global unificado (`GLOBAL_ITEM_PICKER_CATALOG`) |
| [importacion-exportacion-maestros-excel.md](importacion-exportacion-maestros-excel.md) | **Maestros Excel:** flota e inventario; export profesional, validacion previa, requisitos, commit configurado y bajas con impacto |
| [ui-quickadd-global-picker-dialogos-nativos.md](ui-quickadd-global-picker-dialogos-nativos.md) | **UI:** `QuickAddItemModal` + `GlobalItemPicker` + `<dialog>` nativos (control de stock / no usar `overlayInsideDialog=true` en el picker) |
| [ui-notificaciones-toasts-top-layer.md](ui-notificaciones-toasts-top-layer.md) | **UI:** toasts sobre `<dialog>` (top layer del navegador); `popover="manual"` en `app-toast` |
| [ui-modales-tema-claro.md](ui-modales-tema-claro.md) | **UI:** modales en `data-theme='light'` — tokens (`text-main`, `bg-surface`), evitar `text-white` sobre `bg-dark`; `app-confirm-modal` + overrides en `styles.scss` |
| [ui-busquedas-iconos-checkbox.md](ui-busquedas-iconos-checkbox.md) | **UI:** lupa duplicada (`type="search"` vs icono SVG), reset en `styles.scss`, `role="searchbox"`; checkboxes custom y `:where()` |
| [control-stock-umbrales-vs-correccion-fisica.md](control-stock-umbrales-vs-correccion-fisica.md) | **Control de stock:** dos acciones (Umbrales vs Corregir físico); no mezclar conteo con mín/máx |
| [pruebas-unitarias.md](pruebas-unitarias.md) | **Testing (índice maestro):** reglas BaseLogic EAM, `npm run test:domain` / `test:domain:watch`, flujo agente |
| [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md) | **Jest / Nest:** inventario de specs, `jest-mock-extended`, cobertura inventario (kardex) y compras (ACL) |
| [pruebas-unitarias-frontend.md](pruebas-unitarias-frontend.md) | **Angular 18:** standalone, Signals, inventario smoke |
| [entornos-git-despliegue.md](entornos-git-despliegue.md) | **Git / Coolify:** `main` prod; rama `develop` + CI |
| [coolify-qa-setup.md](coolify-qa-setup.md) | **Coolify QA:** compose, DNS, variables, primer deploy, datos iniciales |

Podéis añadir `integraciones.md`, `errores-conocidos.md`, etc., según necesidad.
