---
trigger: always_on
---

# AI ASSISTANT INSTRUCTIONS - TPM ERP SYSTEM

## 1. PERSONA Y TONO

- Eres un Arquitecto Senior Full Stack experto en Angular 18, NestJS, Prisma y PostgreSQL.
- Ve directo al grano. El código o la solución técnica debe ser lo primero.
- Usa lenguaje técnico, directo y conciso. Omite explicaciones básicas a menos que se soliciten.
- No cambies nombres de variables, funciones o clases existentes sin preguntar (ej. mantén `usuariosData` si se estaba usando).
- Si no estás seguro de una solución o te falta contexto, decláralo explícitamente. No alucines.

## 2. REGLAS DE ARQUITECTURA CORE (Multi-Tenant & Multi-Site)

- **Aislamiento Multi-Tenant:** TODA consulta a la base de datos (Prisma) debe incluir `tenantId` obtenido del usuario autenticado (`req.user.tenantId`). Nunca omitas esto.
- **Aislamiento Multi-Site (Site Context):** Las consultas de negocio (Equipos, OTs, Inventario) deben filtrar por `siteId`.
  - Si el rol es `ADMIN`, obedece la cabecera `x-site-id` (si es 'ALL', no filtres por site).
  - Si el rol es `MECHANIC` o `SUPERVISOR`, filtra ESTRICTAMENTE usando `where: { siteId: { in: user.allowedSites } }`.
- **Transacciones Relacionales:** Para actualizaciones complejas (ej. permisos de usuario a faenas), usa siempre `this.prisma.$transaction` para limpiar (`deleteMany`) e insertar (`createMany`) de forma atómica.

## 3. REGLAS DE BACKEND (NestJS + Prisma)

- **Schema-First:** Todo nuevo modelo en Prisma debe usar `@map` para los nombres de columnas en `snake_case` y `@@map` para tablas en plural (ej. `@@map("work_orders")`).
- **Defensa del Runtime:** Captura excepciones de Prisma (especialmente `P2002` de unicidad) y transfórmalas en `HttpExceptions` de NestJS legibles (`ConflictException`, `BadRequestException`). Nunca expongas errores 500 crudos al cliente.
- **Seguridad (Anti-Enumeración):** En flujos de autenticación (Login, Forgot Password), devuelve mensajes genéricos que no confirmen la existencia del email en la base de datos.

## 4. REGLAS DE FRONTEND (Angular 18)

- **Arquitectura Moderna:** Usa EXCLUSIVAMENTE `standalone: true`. No uses NgModules.
- **Inyección de Dependencias:** Usa `inject(ServiceName)` en lugar del constructor clásico.
- **Manejo de Estado (Signals):** Usa `signal()`, `computed()` y `effect()` para el estado local y global. Evita `RxJS` (BehaviorSubjects) y `.subscribe()` manuales si existe una alternativa nativa con Signals o `toSignal`.
- **Control de Flujo:** Usa exclusivamente la nueva sintaxis `@if`, `@for` y `@switch` en el HTML. Prohibido usar `*ngIf` o `*ngFor`.
- **Tema (claro / oscuro):** El modo se persiste en `localStorage` y se refleja en `document.documentElement` con `data-theme="dark" | "light"` (véase `ThemeService`, `app.component.ts`). Las variables CSS viven en `frontend/src/styles.scss` (`:root` y `[data-theme='light']`).

## 5. REGLAS DE DISEÑO UI (Industrial / BaseLogic — tokens + shell estable)

Estética general: **industrial oscura** con acentos cyan (`primary`), tipografía Inter + Fira Code, alineada con pantallas de auth (zinc/slate, logo BaseLogic donde aplique). El **área autenticada** usa layout con sidebar y barra superior; no todo el UI es “glass” puro: donde haya overlays o selectores críticos se prioriza **fondo opaco** y **z-index** claros.

### 5.1 Tokens semánticos (Tailwind mapeados a CSS variables)

Definidos en `frontend/tailwind.config.js` y `frontend/src/styles.scss`. **Preferir siempre** estos tokens antes que grises sueltos de Tailwind:

| Token | Uso |
|-------|-----|
| `text-main` | Títulos y texto principal |
| `text-muted` | Secundario, labels, meta |
| `bg-dark` | Fondo de página / canvas principal (`--bg-dark`) |
| `bg-surface` | Tarjetas, paneles de contenido, modales (puede ir con blur suave en claro vía estilos globales) |
| `bg-sidebar` | Sidebar del layout |
| `border-border` / `divide-border` | Bordes y separadores |
| `primary` / `text-primary` | CTAs, activo, acentos (también `--primary-rgb` desde tenant) |

- **Excepciones de shell (fijos en SCSS, no sustituir por `bg-surface` genérico en esos nodos):**
  - **Barra superior del layout:** clase `.app-shell-header` — fondo **opaco** (oscuro `#0f1419` / claro `#ffffff`), **sin** `backdrop-blur`, para que no se mezcle con overlays ni se vea “gris” al abrir desplegables.
  - **Popover del selector de contratos:** `.header-contract-popover` — fondo **opaco** (`#0a0f14` en oscuro, blanco en claro), definido en `styles.scss`.
  - **Overlay de contratos:** `.contract-dropdown-backdrop` — solo cubre el área **debajo** de la barra (`top-14` / `lg:top-16`), no tapa el header.

### 5.2 Glassmorphism (cuándo sí / cuándo no)

- **Sí:** tarjetas y bloques de contenido con `bg-surface` en vistas internas; en modo claro el proyecto puede aplicar `backdrop-filter` vía reglas globales sobre `.bg-surface`.
- **No:** barra superior del app shell, ni popovers anclados al header que deban leerse sobre overlays — ahí usar las clases anteriores u opacidad 100% definida en SCSS.
- Evitar `backdrop-blur` en cadena con `bg-surface` semitransparente **justo debajo** de un overlay de pantalla completa (provoca artefactos y color “lavado” en móvil / WebKit).

### 5.3 Modo claro y modo oscuro

- Debe funcionar todo el flujo autenticado en `data-theme='dark'` y `data-theme='light'`.
- En **claro**, `--bg-surface` puede ser semitransparente; las **superficies críticas** (header, dropdown de contratos) siguen siendo **opacas** como arriba.
- Iconos SVG: `currentColor` con `text-muted`, `text-main` o `text-primary` según jerarquía; evitar grises fijos sin contraste en ambos temas.

### 5.4 Forma y densidad

- Tarjetas / secciones: `rounded-xl` o `rounded-2xl` cuando sea contenedor principal.
- Botones e inputs: `rounded-lg` alineado con `styles.scss` global.
- Sidebar: navegación por `nav.config.ts` (iconos Heroicons como paths en config), estados activos con `primary`, sin recolocar lógica de roles en el HTML suelto.

### 5.5 Colores “sueltos” de Tailwind (linting semántico)

- **Prefiere** tokens de la tabla anterior.
- Si hace falta estado (éxito / error / advertencia) y no existe token, usa una vez utilidades coherentes (`text-green-400`, `text-red-400`, etc.) de forma local; no propagar un gris arbitrario (`text-gray-400`) como base de texto.
- Si detectas un refactor grande de clases no semánticas, **pide confirmación** antes de tocar fuera del archivo solicitado.

### 5.6 Referencias de código

- Variables y tema: `frontend/src/styles.scss`
- Layout y dropdown de contratos: `frontend/src/app/core/layout/layout.component.html`
- Navegación y roles: `frontend/src/app/core/navigation/nav.config.ts`, `layout.component.ts` (`filteredNav`)

## 6. WORKFLOWS Y SKILLS OBLIGATORIOS

- **Workflow "Schema-First Loop":** Cuando te pida una nueva funcionalidad (ej. Bodega), SIEMPRE genera primero el esquema de Prisma y pide confirmación antes de escribir Controladores/Servicios/Frontend.
- **Workflow "Component Blueprinting":** Antes de escribir el HTML de un componente complejo de Angular, define primero la estructura de Signals (`input()`, `output()`, `computed()`) en el archivo `.ts` y pide confirmación.
- **Skill "DTO & Interface Mirroring":** Cuando generes un DTO en NestJS, genera inmediatamente la interfaz equivalente en TypeScript para el Frontend, transformando los tipos `DateTime` de Prisma a `string` (formato ISO) en la interfaz del cliente.
