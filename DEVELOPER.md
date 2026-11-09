# Developer guide

For full-stack, backend, frontend, and integration developers working on SOBA. This doc is brief by design; more detail is in [In Detail](#in-detail) at the bottom where needed.

---

## How we work

Work from **branches** (not forks) off `develop`. Open a **pull request** into `develop`. Each PR can be deployed in isolation for review; deployment and review environments are described in a separate DevOps guide.

### Developer responsibilities / PR review readiness

Before requesting review, ensure:

- **All checks pass** — e.g. `pnpm check` at the repo root (type-check and lint for lib, backend and frontend). See [pnpm](#pnpm) for root commands.
- **Unit tests** — New or changed behaviour is covered by tests. See [Backend](#backend), [Frontend](#frontend) and [Lib](#lib) for how tests are run and where they live.

---

## Devcontainer

The project uses a VS Code devcontainer (`.devcontainer/`). Open the repo in VS Code and **Reopen in Container** so all tooling and env are consistent. It runs via `docker-compose.devcontainer.yml`; to cap the container's memory/swap or the Node heap for your machine, see per-developer resource limits in [`.devcontainer/README.md`](.devcontainer/README.md).

### Tools added to the OS

| Tool                          | Check / help               | Purpose                              |
| ----------------------------- | -------------------------- | ------------------------------------ |
| **Node.js** (24)              | `node --version`           | Runtime (npm + pnpm via corepack)    |
| **[pnpm](https://pnpm.io)**   | `pnpm --version`           | Monorepo package manager (see below) |
| **PostgreSQL client**         | `psql --version`           | DB client; connect to Postgres       |
| **mongosh**                   | `mongosh --version`        | MongoDB shell                        |
| **jq**                        | `jq --help`                | JSON on the CLI                      |
| **curl**                      | `curl --version`           | HTTP and downloads                   |
| **k6**                        | `k6 version`               | Load testing                         |
| **oc** (OpenShift CLI)        | `oc version`               | OpenShift / Kubernetes workflows     |
| **Docker** (Docker-in-Docker) | `docker --version`         | Sidecars, images, compose            |
| **GitHub CLI**                | `gh --version`             | `gh auth`, PRs, etc.                 |
| **kubectl**                   | `kubectl version --client` | Kubernetes CLI                       |
| **Helm**                      | `helm version`             | Kubernetes package manager           |

[Playwright](https://playwright.dev) (Chromium) is installed for the integration app via `npm exec --prefix integration/playwright -- playwright install chromium`. VS Code extensions: ESLint, Prettier, Docker, PostgreSQL, Kubernetes Tools.

### Host architecture (ARM vs AMD)

The devcontainer image is **multi-arch**: `linux/amd64` (e.g. Mac Intel, typical Linux) and `linux/arm64` (e.g. Mac Silicon). Both are supported. The [Form.io](https://form.io) sidecar in `.devcontainer/docker-compose.yml` is pinned to `platform: linux/amd64` (no native arm image), so on Apple Silicon it runs under emulation automatically—no extra compose override.

### Docker Compose (sidecar services)

From **inside** the devcontainer, start local backing services:

```bash
docker compose -f .devcontainer/docker-compose.yml up -d
```

This starts:

- **MongoDB** (port 27017) — used by Form.io
- **[PostgreSQL](https://www.postgresql.org) 17** (port 5432) — app DB (default DB `postgres`; migrate creates `soba`)
- **Form.io** (port 3001) — form runtime
- **Temporal** (gRPC port 7233) — workflow engine
- **Temporal UI** (port 8088) — workflow dashboard

**Inside the devcontainer** use `host.docker.internal` to reach sidecars from backend processes (e.g. `mongodb://host.docker.internal:27017`, `postgresql://postgres:postgres@host.docker.internal:5432/postgres`, `http://host.docker.internal:3001`). The `app` service sets `extra_hosts: host.docker.internal:host-gateway` so that this hostname works on Linux as well as on Docker Desktop (Mac/Windows). **Committed `.env.example` files use `localhost`** for DB, Form.io, and API URLs — that works when the browser and forwarded ports are on the host (e.g. http://localhost:3000 with `NEXT_PUBLIC_SOBA_API_BASE_URL=http://localhost:4000/chefs/api/v1`). Use `host.docker.internal` in backend env when the API server runs inside the container and must reach compose services. Form.io login: `formio@localhost.com` / `formio`.

**Database (migrate + seed):** After the sidecars are up, from the repo root run `pnpm db:init` (or `pnpm dev:db:up` to start services and init in one step). See [Drizzle](#drizzle) for individual `db:migrate` / `db:seed` commands.

---

## pnpm

The repo is a **[pnpm](https://pnpm.io) workspace** (faster installs, shared store, strict dependency graph). Root `package.json` delegates to the `lib`, `frontend` and `backend` workspaces.

**Why pnpm:** Single lockfile and workspace protocol for frontend + backend, disk-efficient store, and consistent installs across dev and CI.

### Root commands (workspace root)

| Command                                            | What it does                                                    |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm install`                                     | Install all workspace deps (run after clone / when deps change) |
| `pnpm build`                                       | `build:lib`, `build:frontend`, then `build:backend`             |
| `pnpm build:frontend` / `pnpm build:backend`       | Build one app                                                   |
| `pnpm build:lib`                                   | Build the shared lib into `lib/dist`                            |
| `pnpm test`                                        | Run lib, frontend and backend tests                             |
| `pnpm test:frontend` / `pnpm test:backend`         | Test one app                                                    |
| `pnpm test:lib`                                    | Test the shared lib                                             |
| `pnpm lint`                                        | Lint lib, frontend and backend                                  |
| `pnpm lint:fix`                                    | Lint with auto-fix, all three                                   |
| `pnpm db:migrate`                                  | Run pending DB migrations (backend)                             |
| `pnpm db:seed`                                     | Seed DB (run after migrate)                                     |
| `pnpm db:init`                                     | Migrate then seed (full DB setup)                               |
| `pnpm db:dev-data`                                 | Build/remove development data ([guide](backend/src/features/dev-data/README.md)) |
| `pnpm lint:frontend` / `pnpm lint:backend`         | Lint one app                                                    |
| `pnpm lint:fix:frontend` / `pnpm lint:fix:backend` | Lint fix one app                                                |
| `pnpm lint:lib` / `pnpm lint:fix:lib`              | Lint or lint fix the shared lib                                 |
| `pnpm format`                                      | Prettier write, lib and both apps                               |
| `pnpm format:check`                                | Prettier check, lib and both apps (CI gate)                     |
| `pnpm format:frontend` / `pnpm format:backend`     | Format one app                                                  |
| `pnpm format:check:frontend` / `pnpm format:check:backend` | Format check one app                                    |
| `pnpm format:lib` / `pnpm format:check:lib`        | Format or format check the shared lib                           |
| `pnpm check`                                       | Type/style checks for lib and both apps                         |
| `pnpm check:frontend` / `pnpm check:backend`       | Check one app                                                   |
| `pnpm check:lib`                                   | Check the shared lib                                            |
| `pnpm qa`                                          | `check` then `test` (PR readiness shortcut)                     |
| `pnpm qa:build`                                    | `qa` then `build`                                               |
| `pnpm dev:services:up`                             | Start sidecars via docker compose (`up -d --wait`)              |
| `pnpm dev:db:up`                                   | `dev:services:up` then `db:init`                                |
| `pnpm clean:workspace`                             | Remove deps, build outputs, and test artifacts (keeps `.env`)   |
| `pnpm clean:workspace:full`                        | Same as above, plus remove gitignored env files                 |

Package manager is pinned in `package.json` (`packageManager`: `pnpm@10.28.2`). The `integration` app lives outside the workspace and uses **`package-lock.json`** (npm); post-create runs `npm ci --prefix integration/playwright`. From the repo root you can still run `pnpm -C integration/playwright test` once deps are installed.

**Troubleshooting installs:** If `pnpm install` fails with `EINVAL` on a VM-backed workspace mount (Docker Desktop, Rancher, Cursor remote), run `pnpm clean:workspace && pnpm install` from the repo root.

---

## Launch & tasks

VS Code config lives in `.vscode/launch.json` and `.vscode/tasks.json`.

**Launch (`launch.json`):** Run and debug from the Run and Debug view.

| Configuration                            | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| **SOBA Backend**                         | Start backend dev server (`pnpm dev` in `backend/`)         |
| **SOBA Temporal Worker (soba)**          | Worker on the `soba` queue (health port 9090)               |
| **SOBA Frontend**                        | Start frontend dev server (`pnpm dev:watch` in `frontend/`) |
| **SOBA (Backend + Temporal + Frontend)** | Compound: backend, Temporal worker, and frontend            |
| **SOBA (Backend + Temporal)**            | Compound: backend and Temporal worker                       |
| **SOBA Frontend (Chrome)**               | Attach Chrome to frontend (URL `http://localhost:3000`)     |

**Tasks (`tasks.json`):** Run from Command Palette → “Tasks: Run Task”.

| Task                   | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| **Dev Services: Up**   | Start sidecars (`docker compose ... up -d --build`) |
| **Dev Services: Down** | Stop and remove the dev service containers          |

You can also run `docker compose -f .devcontainer/docker-compose.yml up -d` in a terminal, or right-click `docker-compose.yml` and use **Compose Up**.

---

## Environment files

**Committed:** `*.env.example` and `*.env.local.example` (templates).

**Not committed:** `.env` and `.env.local` (active config, often contain secrets).

Example files use **`localhost`** for local sidecars and the SOBA API so host-browser dev works out of the box. When backend processes run inside the devcontainer and must reach compose services directly, switch DB/Form.io URLs to **`host.docker.internal`** (see [Docker Compose](#docker-compose-sidecar-services)). When adding external services, use **development** endpoints and config where they exist — never production URLs or production-only settings in examples. **Never put secrets or passwords for external services in example files**; document the keys and put real values in `.env.local` (or equivalent local override) only.

The devcontainer **initialize** and **post-create** steps copy from example files only when the target does not exist (`cp -n`). **Post-start** refreshes `.env` from `.env.example` on each container start so base config stays in sync with the repo. **`.env.local` is never overwritten** — it is created once from `.env.local.example` and is up to you to maintain (secrets, credential overrides, local defaults). If you add secrets or change defaults in `.env.local`, keep it updated yourself; tooling will not replace it.

| App      | Base template                             | Local overrides (once, never overwritten)           |
| -------- | ----------------------------------------- | --------------------------------------------------- |
| Backend  | `backend/.env.example` → `backend/.env`   | `backend/.env.local.example` → `backend/.env.local` |
| Frontend | `frontend/.env.example` → `frontend/.env` | —                                                   |

**Loading:**

- Backend uses **[dotenv](https://github.com/motdotla/dotenv)**: it loads `.env` then `.env.local` (with `override: true`) so local values win.
- Frontend uses **[Next.js](https://nextjs.org) built-in** env loading (no extra lib): `.env`, `.env.local`, `.env.development` / `.env.production` are read automatically; expose client-side values via the `NEXT_PUBLIC_` prefix.
- The devcontainer does **not** inject `backend/.env` or `backend/.env.local` into the container environment; shells and one-off CLI commands only see variables you export yourself. App servers started inside the container still pick up the files through dotenv / Next.js.

---

## Backend

**Stack:**

- **Runtime:** [Express](https://expressjs.com), TypeScript
- **DB:** [Drizzle](https://orm.drizzle.team) ORM, PostgreSQL (`pg`)
- **Auth:** Bearer-token APIs with Passport-backed stateless verification, IdP plugins (e.g. BC Gov SSO)
- **API docs:** OpenAPI/Swagger ([Zod](https://zod.dev) + `@asteasolutions/zod-to-openapi`)
- **Logging:** [Pino](https://getpino.io)

### Scripts

| Command                        | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `pnpm dev`                     | nodemon: `tsc && node dist/src/app.js` on change (port 4000) |
| `pnpm build`                   | Compile TypeScript to `dist/`                                |
| `pnpm serve`                   | Build then run `node dist/src/app.js`                        |
| `pnpm start`                   | Run `node dist/src/app.js` (assumes already built)           |
| `pnpm test`                    | Run Jest unit tests                                          |
| `pnpm test:watch`              | Jest in watch mode                                           |
| `pnpm test:coverage`           | Jest with coverage report                                    |
| `pnpm test:parallel`           | Jest with `--maxWorkers=2`                                   |
| `pnpm lint` / `lint:fix`       | ESLint; fix applies auto-fix                                 |
| `pnpm format` / `format:check` | Prettier write / check                                       |
| `pnpm type-check`              | `tsc --noEmit`                                               |
| `pnpm check`                   | Type-check + lint (run before PR)                            |
| `pnpm temporal-worker`         | Run Temporal worker once (`tsx temporal-worker.ts`)          |
| `pnpm temporal-worker:dev`     | Run Temporal worker with watch                               |
| `pnpm db:dev-data`             | Build/remove a development data set (see below)              |

Tests live under `backend/tests/`. See [In Detail — Testing](#testing) for approach and supertest usage.

### Development data

`pnpm db:dev-data --seed --username <idir-username>` builds a disposable set of workspaces, forms,
submissions, users, and groups, in Postgres and in the form engine, sized to exercise list paging
(`--size small|medium|large`, default `large`). `--purge` removes it again. Generated workspaces,
forms, groups and users are named with a `[dev] ` prefix. Run it after `pnpm db:init`.

Gated on the `dev-data` feature, which the migration inserts disabled. Set
`FEATURE_DEV_DATA_STATUS=enabled` and run `pnpm db:seed`; deployments set it per environment
through `backend.features` in the Helm values. Left disabled in production.

`FEATURE_<CODE>_STATUS` works for any backend feature: empty leaves the migrated status alone, and
any `feature_status` code (`enabled`, `disabled`, `experimental`, `deprecated`) overrides it. Only
`db:seed` reads it; everything else reads the stored status, so a change to the variable takes
effect on the next seed and not before.

See [`backend/src/features/dev-data/README.md`](backend/src/features/dev-data/README.md) for what
gets built and for the gitignored owner file that seeds a fresh database without signing in first.

### Temporal

[Temporal](https://temporal.io) sidecar runs in compose (port 7233; UI on 8088). Worker scripts above poll `TEMPORAL_TASK_QUEUE` (default `soba`). Queue can be overridden per worker deployment. `.env.example` ships **`TEMPORAL_ALLOWED=true`** so the compound launch configs connect out of the box; set it to `false` to make the workers exit without connecting. The code default (when the variable is unset) is still `false`. See `docs/temporal.md` for workflow details.

### API layout

- **Base path:** `/api/v1`. Core domains live under this prefix.
- **Public (no JWT):** `/api/v1/meta`, `/api/v1/health`. OpenAPI spec: `/api/docs/openapi.json`; Swagger UI: `/api/docs`.
- **Public submissions (optional JWT):** `POST /api/v1/submissions` and `POST /api/v1/submissions/:id/save` are mounted **before** the JWT middleware. They use optional auth (`checkJwtOptional`, `resolveActorOptional`) and **`checkFormVisibility`** so anonymous users can submit when the form version's `visibility` allows it.
- **Protected:** Other `/api/v1` routes use `checkJwt()` then `resolveActor`; core context (workspace, etc.) is required for domain routes. Admin routes under `/api/v1/admin` additionally require SOBA admin (`requireSobaAdmin`).
- **CORS:** All origins allowed in `development`; in other environments set comma-separated **`CORS_ORIGIN`** or cross-origin requests are blocked.

### Core domains

| API path                                           | Purpose                                                               | Access                                 |
| -------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| `/api/v1/meta`                                     | Plugins, features, form-engines, build, frontend-config, codes, roles | Public                                 |
| `/api/v1/health`, `/api/v1/health/ready`           | Liveness and readiness                                                | Public                                 |
| `/api/v1/workspaces`, `/api/v1/workspaces/current` | List workspaces, current workspace                                    | Protected                              |
| `/api/v1/me`                                       | Current actor                                                         | Protected                              |
| `/api/v1/members`                                  | Workspace members                                                     | Protected                              |
| `/api/v1/forms`, `/api/v1/form-versions`, …        | Forms and form versions CRUD, save, publish/unpublish/restore, schema | Protected                              |
| `/api/v1/submissions`, …                           | Submissions CRUD, save, read data (`GET /:id/data`)                   | Protected (+ public create/save above) |
| `/api/v1/admin`                                    | SOBA platform admins (list, add, remove)                              | Admin                                  |

Key form-version routes: `POST /:id/publish`, `POST /:id/unpublish`, `POST /:id/restore`, `GET|POST /:id/schema` (read/provision schema in the form engine).

### Plugin implementations

The backend uses a **plugin architecture** so that external services and infrastructure can be swapped without changing core. Plugins are discovered from `backend/src/plugins/` (each directory is a plugin module; `shared/` holds code shared between plugins). Most kinds select one plugin by a default code; IdP uses an ordered list and storage uses profiles. Each plugin reads its own `PLUGIN_<CODE>_*` keys (storage reads `STORAGE_PROFILE_<PROFILE>_*`). For auth, Passport is the protected-route entry point, but IdP plugins still provide provider-specific token verification and claim mapping. See [In Detail - Configuration of plugins and features](#configuration-of-plugins-and-features). To add a plugin or a new kind, follow [How to add a plugin](docs/how-to-add-a-plugin.md).

**Plugin kinds and current implementations:**

| Kind                    | Purpose                                  | Implementations                                  | Selected by (default)                                                                |
| ----------------------- | ---------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Form engine**         | Render/store forms and submissions       | `formio-v5` (Form.io v5)                         | `FORM_ENGINE_DEFAULT_CODE` (`formio-v5`)                                             |
| **IdP (auth)**          | JWT validation, claim mapping            | `idp-bcgov-sso` (code `bcgov-sso`), `idp-github` | `IDP_PLUGINS`, tried in order (`bcgov-sso`)                                          |
| **Cache**               | Key-value cache                          | `cache-memory`, `cache-redis`                    | `CACHE_DEFAULT_CODE` (`cache-memory`)                                                |
| **Message bus**         | Cross-replica pub/sub                    | `messagebus-memory`, `messagebus-redis`          | `MESSAGEBUS_DEFAULT_CODE` (`messagebus-memory`)                                      |
| **Event stream**        | Durable at-least-once streams            | `eventstream-memory`, `eventstream-redis`        | `EVENTSTREAM_DEFAULT_CODE` (`eventstream-memory`)                                    |
| **Temp storage**        | Temporary files                          | `tempstorage-os`, `tempstorage-mount`            | `TEMPSTORAGE_DEFAULT_CODE` (`tempstorage-os`)                                        |
| **Virus scan**          | Scan uploaded files                      | `virusscan-noop`, `virusscan-clamav`             | `VIRUSSCAN_DEFAULT_CODE` (`virusscan-noop`; Helm sets `virusscan-clamav`)            |
| **Storage**             | File storage, one backend per profile    | `storage-memory`, `storage-local`, `storage-s3`  | `STORAGE_PROFILES` (one `storage-memory` profile in development; required elsewhere) |
| **Document generation** | Render documents                         | `docgen-noop`, `cdogs-v2`, `cdogs-v3`            | `DOCUMENT_GENERATION_DEFAULT_CODE` (`docgen-noop`); cdogs is feature-gated           |
| **Tenant engine**       | The caller's tenants (`GET /me/tenants`) | `tenant-noop`, `cstar-v1` (CSTAR)                | `TENANT_ENGINE_DEFAULT_CODE` (`tenant-noop`)                                         |

IdP plugins are ordered via env (`IDP_PLUGINS`); the first successful IdP wins. Passport orchestrates the ordered plugin attempts and the winning plugin supplies the mapped identity used by core. IdP env prefixes follow plugin codes (e.g. `bcgov-sso` reads `PLUGIN_BCGOV_SSO_*`, `idp-github` reads `PLUGIN_IDP_GITHUB_*`).

### Features

**Concept:** Features are optional capabilities that can be enabled or disabled per deployment. The `soba.feature` table holds a registry (code, name, description, version, **status**). Status values live in `soba.feature_status` (e.g. `enabled`, `disabled`, `experimental`, `deprecated`). Only features with status `enabled` are considered on for behaviour that checks feature flags. Codes and roles are extensible: **code tables** (e.g. `form_status`, `form_version_state`, `workspace_membership_role`, `role_status`) use `(code, source)` with `source = 'core'` or a feature code so features can add their own codes; **roles** can have `source = 'feature'` and `feature_code` set. Seed data inserts core codes and feature statuses; see [In Detail — Enable/Disable features, add codes + roles](#enabledisable-features-add-codes--roles-for-feature).

### Form engines and formio-v5

Form rendering and submission storage are delegated to a **form engine** plugin. The default is `formio-v5` (Form.io v5). The core stores form and submission metadata in PostgreSQL; the form engine (Form.io/Mongo) holds form definitions and submission payloads. The **FormioEngineAdapter** (`backend/src/plugins/formio-v5/`) talks to Form.io over HTTP using a **server-side admin client**. Config is via `PLUGIN_FORMIO_V5_*` (API URLs, admin credentials). `FORM_ENGINE_DEFAULT_CODE` selects which engine to use; forms reference an engine code.

**Server-mediated flow (no browser → Form.io proxy):** The browser never calls Form.io directly. Protected API routes write a schema when a form or version is created (`POST /forms`, `POST /form-versions`) or saved, and read it back (`POST|GET /form-versions/:id/schema`); `SubmissionService.save()` creates submission documents in the engine server-side and stores `engine_submission_ref`. `engine_sync_status` on domain rows tracks provisioning state. Readiness is on the adapter and reported via `/api/v1/health/ready`. See [In Detail — Form engine cross-references](#form-engine-cross-references).

### Form engine cross-references

Data lives in **two systems**: domain metadata in **PostgreSQL** and form definitions/submission payloads in the **form engine**. Cross-reference columns: `form_version.engine_schema_ref`, `submission.engine_submission_ref`. Provision via `POST /form-versions/:id/schema`, the only way a version's `engine_schema_ref` is set. See [In Detail — Form engine cross-references](#form-engine-cross-references).

### Auth plugins and responsibilities

**IdP plugins** are responsible for: (1) validating the token (issuer, signature via JWKS or provider API), and (2) mapping claims to a normalised identity (subject, profile, optional `soba_admin`). Protected routes enter auth through Passport: `checkJwt()` calls `passport.authenticate(..., { session: false })`, and the composite Passport strategy tries each configured IdP in order. The first success still sets `req.idpPluginCode` and `req.authPayload`, and Passport also authenticates the request principal. **resolveActor** runs after `checkJwt()`: it uses the IdP’s claim mapper to get subject/profile, finds or creates the app user, sets `req.actorId` and `req.isSobaAdmin`, applying the IdP admin claim only when it differs from the stored row. So: Passport = “run the protected-route auth flow”; IdP = “is this token valid and who is it?”; core = “resolve to internal actor and admin flag”. IdPs are configured with `IDP_PLUGINS` (comma-separated) and plugin-specific env (e.g. `PLUGIN_BCGOV_SSO_JWKS_URI`). `session: false` is intentional because it keeps the auth path stateless, aligned with bearer-token APIs, easier to scale across instances, and compatible with multiple IdP plugins tried in order. See [In Detail — Auth flow](#auth-flow).

### Drizzle

Schema and queries live in TypeScript; migrations are SQL in `backend/drizzle/`. The app uses **drizzle-orm** at runtime; **drizzle-kit** (run via `npx` from `backend/`) handles schema introspection and migration generation. Config: `backend/drizzle.config.ts` (reads `DATABASE_URL` from `.env`).

| Command                    | Where                   | Purpose                                                                   |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `pnpm db:migrate`          | repo root or `backend/` | Ensure DB exists, then run all pending migrations from `drizzle/`         |
| `pnpm db:seed`             | repo root or `backend/` | Seed data (run after migrate)                                             |
| `pnpm db:init`             | repo root               | Migrate then seed (convenience for local setup)                           |
| `npx drizzle-kit generate` | `backend/`              | Generate a new migration from schema changes (writes SQL into `drizzle/`) |
| `npx drizzle-kit studio`   | `backend/`              | Open Drizzle Studio (DB GUI); requires `DATABASE_URL`                     |

Schema modules: `backend/src/core/db/schema/` — `core.ts` (users, workspaces, IdPs, `idp_group`), `forms.ts` (forms, versions, submissions, revisions), `codes.ts`, `feature.ts`, `roles.ts`, `plugins.enterprise.ts`. Migrations live in `backend/drizzle/` (currently `0000`–`0005`). After changing schema, run `drizzle-kit generate`, then `pnpm db:migrate` to apply.

---

## Frontend

**Stack:**

- **Runtime:** [Next.js](https://nextjs.org) 16, React 19, TypeScript
- **State:** [Redux Toolkit](https://redux-toolkit.js.org), react-redux, next-redux-wrapper
- **UI:** Bootstrap
- **Auth:** [Keycloak](https://www.keycloak.org) (keycloak-js) — BC Gov SSO
- **Testing:** [Vitest](https://vitest.dev)

### Scripts

| Command                         | Purpose                                |
| ------------------------------- | -------------------------------------- |
| `pnpm dev`                      | Next.js dev server (default port 3000) |
| `pnpm build`                    | Production build                       |
| `pnpm start`                    | Run production server (after build)    |
| `pnpm test` / `pnpm test:watch` | Vitest unit tests                      |
| `pnpm check`                    | Type-check + lint                      |

Tests live under `frontend/tests/`. See [In Detail — Testing](#testing).

### App structure and routing

- **App Router:** `app/layout.tsx` is the root (html/body, globals.css). `app/[lang]/layout.tsx` wraps locale routes with `DictionaryProvider`, `Header`, `SideNav`, `<main>`, and `Footer`. Locale is required (e.g. `/en`, `/fr`). Home (`app/[lang]/page.tsx`) is the signed-out landing page. `AppAccessGuard` redirects signed-in users from it to `/forms` (or `/onboarding` or `/workspaces` for users without workspaces) when `design-mode` is allowed, otherwise to `/my-forms`.
- **Key routes:** `/{lang}/build` (design-mode), `/{lang}/forms` (form list), `/{lang}/my-forms` and `/{lang}/my-submissions` (submit-mode), `/{lang}/form/{formId}` (submit/render), `/{lang}/meta` (feature support).
- **Where code lives:** `app/` - pages, layouts, shared UI (`app/ui/`). `src/features/` - feature UI (admin, designer, formio-v5, onboarding, submit-mode, workspaces). `src/shared/` - API, config, feature flags. `src/app/` - providers and routing. `lib/` - Redux store, slices, hooks, runtime config. Path aliases: `@/lib`, `@/app`, `@/src`.
- **Adding pages:** Add under `app/[lang]/`; use the locale layout for nav and dictionary.

### Runtime config and env

- **Env:** `NEXT_PUBLIC_SOBA_API_BASE_URL` is the fallback backend base URL (used when loading runtime config and for API calls until config is loaded). No other frontend env is required for basic run; see `.env.example`.
- **Runtime config:** The app loads config from the backend at `/meta/frontend-config` (Keycloak url/realm/clientId, api.baseUrl). It’s fetched when Keycloak initializes and cached; `getSobaApiBaseUrl()` and Keycloak settings come from this. See [In Detail — Runtime config (frontend)](#runtime-config-frontend).

### Auth (Keycloak)

- **keycloak-js:** Init with `check-sso` on load; login and logout trigger redirects. The Keycloak instance is kept in a module-level variable (not in Redux); Redux holds token, idTokenParsed, authenticated, initializing, error.
- **useKeycloak():** Exposes token, authenticated, login, logout, init. Header calls `init()` on mount and shows login/logout and display name based on auth state. Protected API calls pass `Authorization: Bearer ${token}`. See [In Detail — Auth flow (frontend)](#auth-flow-frontend).

### Current user (/me)

- After Keycloak is authenticated, the app loads the current user from the backend `GET /me` with the token. Result is stored in Redux (`currentUser` slice: data, status, error). `useCurrentUser()` returns that state; Header uses it to show the backend display name (and falls back to Keycloak id token claims if needed). Clear current user on logout. See [In Detail — Current user flow (frontend)](#current-user-flow-frontend).

### Redux store

- **Slices:** `keycloak` (token, auth state), `currentUser` (data from /me, status), `workspace` (`workspaces`, `activeWorkspaceId`), `notification` (toast state). Store is created with next-redux-wrapper so it’s available in App Router; use `useAppDispatch` / `useAppSelector` (typed). Header loads workspaces and exposes a workspace switcher. See [In Detail — Redux store shape (frontend)](#redux-store-shape-frontend).

### API layer

- **Location:** `src/shared/api/sobaApi.ts` and `sobaApiForms.ts`. Functions use `getSobaApiBaseUrl()` (from runtime config cache or env fallback). Protected endpoints send `Authorization: Bearer ${token}` and, for form/submission calls, **`x-workspace-id`** from the active workspace. Examples: `fetchHealth()`, `fetchWorkspaces(token)`, `fetchCurrentUser(token)`, `getFormVersionSchema(token, ...)`. See [In Detail — API layer (frontend)](#api-layer-frontend).

### Navigation

- **SideNav** (`app/ui/SideNav.tsx`) builds its items from the `design-mode` and `submit-mode` flags, which the locale layout resolves server-side with `createIsFeatureAllowed(meta)`.

### Feature flags

- **Platform:** `GET /meta/features` returns each row with **`platformAllowed`** (from `soba.feature` status). Loaded via `src/shared/config/featuresMeta.ts` (`loadFeaturesMeta`).
- **Per-frontend deployment:** **`NEXT_PUBLIC_SOBA_FEATURES_ALLOWED`** - comma-separated codes (same as meta, e.g. `design-mode`, `submit-mode`, `files`, `marketing`), or **`*`** / **`all`** alone to allow every platform-allowed feature. **Empty/unset** = no codes allowed at the frontend layer (intersected with `platformAllowed`). Use a subset for submit-only or design-only Next.js images that share one API.
- **`createIsFeatureAllowed(meta)`** returns `isFeatureAllowed(code)` = `platformAllowed && frontendAllowlist`. Constants: `FEATURE_CODES` in `src/shared/featureFlags/flags.ts`.

### IDP groups and form visibility

- **Concept:** `soba.identity_provider` holds discrete IdPs (seeded: `idir` inactive, `azureidir` active, `bceidbusiness` inactive). `soba.idp_group` + `soba.idp_group_member` group them logically: **`bcgov`** (`idir`, `azureidir`), **`bceid`** (`bceidbusiness`). Reusable for form access and public submissions.
- **Form visibility:** `form_version.visibility` is a text array of allowed IdP or group codes. `idpGroupRepo.listGroupsForIdp(code)` resolves group membership. **`checkFormVisibility`** middleware enforces visibility on public submission routes; empty visibility falls back to workspace membership when authenticated.

### i18n / dictionaries

- **Locales:** e.g. `en`, `fr` in `app/[lang]/dictionaries.ts`; `getDictionary(locale)` loads JSON (server-only). `DictionaryProvider` and `useDictionary()` give components access to the dictionary. Add or extend dictionary files and keys for new UI.

### UI and styling

`@bcgov/bc-sans`. **Bootstrap** is used.

### Forms

- **Designer** (`src/features/designer/`, `design-mode`): form list at `/{lang}/forms` and builder at `/{lang}/build`; creates a form or version with its schema in one request (`POST /forms`, `POST /form-versions`), saves schema via `POST /form-versions/:id/schema`, loads schema via `GET /form-versions/:id/schema`.
- **Submit** (`src/features/submit-mode/`, `submit-mode`): My Forms and My Submissions at `/{lang}/my-forms` and `/{lang}/my-submissions`; render at `/{lang}/form/{formId}` via **`src/features/formio-v5/`** (`FormioProvider` + `DynamicForm` from `@formio/react`). **The browser does not call Form.io** - schema and submissions go through the SOBA API only.
- **Renderer CSS:** static copies under `public/formio-v5/`; `useFormioV5FormChrome` loads them next to `<Form />` (avoid global Form.io CSS imports with Turbopack).

### Testing

- **Vitest:** Unit tests in `frontend/tests/` (e.g. slices, config, URL helpers). Run with `pnpm test` or `pnpm test:watch`. See [In Detail — Testing](#testing).

### data-testid

- Integration tests (Playwright) select elements by `data-testid`. Add testids to interactive elements, landmarks, lists, and status/state UI as described in [Integration](#integration).

---

## Lib

Shared code for the backend and frontend, used in the workspace as `@soba/lib`:

- Zod schemas and inferred types for the request bodies and responses both sides use, with the sort-field constants and sort enums of each list.
- `normalizeSchema` for Form.io schema import and export.

Query and params schemas stay in the backend. The frontend re-exports the lib types from `frontend/src/types/<domain>.ts`. A runtime import from `@soba/lib` bundles zod and every schema, so frontend code that loads on every page takes the sort fields from `@soba/lib/sort` instead.

lib builds its schemas before the backend extends zod, so calling `.openapi()` on a lib schema directly works or fails depending on which module requires lib first. The backend names a lib schema by cloning it: `XSchema.clone().openapi('Domain_X')`. A composite, such as a list response, is rebuilt with `.extend()` on the named children so the spec references each child with `$ref`. Cloning a composite inlines its children. `libSchemaLoadOrder.test.ts` and `libSchemaOpenApi.test.ts` in `backend/tests/core/api/shared/` check both, and each new schema module and composite needs a row there.

`lib/dist/` is generated and not committed. `pnpm install` builds it (the `prepare` script) and the devcontainer rebuilds it on start. While editing lib, run `pnpm dev` in `lib/` to keep `dist/` current. The backend's watcher follows `backend/src` only, so restart the backend after a lib change.

### Scripts

| Command                        | Purpose                                  |
| ------------------------------ | ---------------------------------------- |
| `pnpm build`                   | Clean `dist/` and compile `src/` into it |
| `pnpm dev`                     | Compile `src/` into `dist/` on change    |
| `pnpm test`                    | Run Jest unit tests                      |
| `pnpm lint` / `lint:fix`       | ESLint; fix applies auto-fix             |
| `pnpm format` / `format:check` | Prettier write / check                   |
| `pnpm type-check`              | `tsc --noEmit` over `src/` and `tests/`  |
| `pnpm check`                   | Type-check + lint (run before PR)        |

Tests live under `lib/tests/`.

---

## Integration

Integration tests live in the **integration** app (repo root). An integration test specialist will own and expand this area; below is the minimum for running tests and for frontend support.

**Tech:** [Playwright](https://playwright.dev) (Chromium). Tests target the running frontend and backend (default: `http://localhost:3000`, `http://localhost:4000/chefs/api/v1`; override with `E2E_BASE_URL`, `E2E_API_BASE_URL`).

**Run tests:** From repo root, `pnpm -C integration/playwright test`. In the devcontainer, dependencies and Playwright Chromium are installed by post-create; otherwise run `npm ci --prefix integration/playwright` and `npm exec --prefix integration/playwright -- playwright install chromium` once.

**Frontend and `data-testid`:** Integration tests locate elements by `data-testid`. Frontend developers **must** add `data-testid` to:

- **Interactive elements** — Buttons, links, form controls (inputs, selects, submit), and other clickable/navigable items that tests need to trigger.
- **Key landmarks** — Header, primary nav, main content sections, and page-level containers so tests can assert on visible regions.
- **Lists** — The list container and each list item (e.g. `data-testid="workspace-list"` and `data-testid="workspace-item-{id}"`) so tests can count or select items.
- **Status and state** — Loading, error, empty-state, and auth-related messages or indicators so tests can wait for or assert on UI state.

Use stable, semantic values (e.g. `workspace-page`, `login-button`, `workspace-item-${id}`). Avoid testids that encode only styling or position.

---

## In Detail

Optional deeper dives for onboarding: plugin/feature configuration, auth flow, feature and code management, and testing approach.

### Form engine cross-references

Form data spans two systems: domain metadata in **PostgreSQL**, and form definitions plus submission payloads in the **form engine** (Form.io/Mongo). Cross-reference columns:

- **form_version.engine_schema_ref** — engine reference for the form schema (e.g. Form.io form id/path).
- **submission.engine_submission_ref** — engine reference for a submission document.

**Creating (server-side):** `FormService.create()` and `FormVersionService.createDraft()` write the engine document first, keyed by the caller-minted version id, then commit the rows `ready` in one transaction. A retry with the same ids returns what the first attempt made.

**Provisioning (server-side):** `FormVersionService.provision()` calls the adapter to create/update the schema in Form.io, sets `engine_schema_ref`, and tracks `engine_sync_status` (`provisioning` → `ready` or `error`). Exposed as `POST /form-versions/:id/schema`; read back via `GET /form-versions/:id/schema`. The designer UI sends schema JSON to this endpoint — browsers never talk to Form.io directly.

**Submissions (server-side):** `SubmissionService.save()` calls `adapter.createSubmission()`, then `appendSubmissionRevision()` stores the new `engine_submission_ref`. Payload reads use `GET /submissions/:id/data`.

The Form.io admin client (`backend/src/plugins/formio-v5/formioV5Client.ts`) automatically re-logs in and retries once on **HTTP 440** when the admin JWT expires.

### Configuration of plugins and features

- **Plugin discovery:** Plugins live under `backend/src/plugins/<pluginDir>/`; `shared/` is skipped. `PluginRegistry` loads each module once and validates the exports named in its `DEFINITION_KINDS` with Zod: `formEnginePluginDefinition`, `documentGenerationPluginDefinition`, `tenantEnginePluginDefinition`, `idpPluginDefinition`, `cachePluginDefinition`, `messagebusPluginDefinition`, `eventStreamPluginDefinition`, `tempStoragePluginDefinition`, `virusScanPluginDefinition`, `storagePluginDefinition` and `pluginApiDefinition`. A module that fails to load, or a definition that fails validation, is logged and skipped. `pluginApiDefinition` is validated but its router is not mounted.
- **Which plugins run:** Each kind's default code selects its plugin, falling back to the default in the [kinds table](#plugin-implementations). IdP: `IDP_PLUGINS` (comma-separated; default from `IDP_PLUGIN_DEFAULT_CODE`); Passport uses the ordered list as its provider chain and stops at the first successful plugin. Storage: one backend per profile in `STORAGE_PROFILES`. A document generation plugin that declares a `featureCode` is used only where that feature is available for the workspace or form, and a scoped one overrides the default. `/api/v1/meta/plugins` marks the active selectable, storage, form engine and tenant engine plugins, and feature-gated plugins whose feature is platform-enabled; it does not mark IdP plugins or the document generation default.
- **Plugin config:** Each plugin gets a `PluginConfigReader` built from env with a prefix. Prefix is `PLUGIN_<NORMALIZED_CODE>_` (e.g. `PLUGIN_FORMIO_V5_API_BASE_URL`). The reader exposes `getRequired`, `getOptional`, `getBoolean`, `getNumber`, `getOptionalNumber`, `getCsv`. Storage profiles read `STORAGE_PROFILE_<PROFILE>_*` instead. Use `.env.example` and `.env.local` for secrets; document keys in examples only.
- **Features (DB):** The `soba.feature` and `soba.feature_status` tables are seeded via `pnpm db:seed`. Feature status (e.g. `enabled`/`disabled`) drives feature-flag behaviour. Roles and code tables support `source` and (for roles) `feature_code` so features can add codes and roles; see [Enable/Disable features, add codes + roles](#enabledisable-features-add-codes--roles-for-feature).

### Admins: table and IdP role mapping

- **Table:** `soba.soba_admin` stores SOBA platform admins (cross-workspace privileges). One row per user; `source` is either `idp` (granted from the IdP token, checked on each request and written only when the claim differs) or `direct` (manually added via admin API, survives IdP revoke). IdP-sourced rows store `identity_provider_code` (e.g. `bcgov-sso`) and `synced_at`, when the IdP last granted or moved the row. Direct grants are for users who must stay admin even when the IdP no longer reports the role.
- **Who decides “is this user an admin?”:** Each **IdP plugin** is responsible for reading the token and returning a boolean in the claim mapper (`sobaAdmin`). The core does not interpret JWT claims for admin; it trusts the IdP’s mapper. On each request, if the mapper returns `sobaAdmin === true` or `false`, the core grants, moves or revokes the IdP-sourced row when it differs from the claim.
- **Example — idp-bcgov-sso:** Looks for the role `soba_admin` in the token. It checks (in order): top-level `roles`, `realm_access.roles`, and `client_roles`. If any of these arrays contain `soba_admin`, the mapper returns `sobaAdmin: true`. So granting a user the Keycloak client role `soba_admin` (or realm role) makes them a SOBA admin when using BC Gov SSO. Other IdPs (e.g. `idp-github`) can use different claim shapes; they just need to set `sobaAdmin` on the mapped result.

### Auth flow

1. **Request hits protected route** — Middleware order: `checkJwt()` then `resolveActor` (and for `/api/v1/admin`, `requireSobaAdmin`).
2. **checkJwt()** — Passport-backed auth middleware: it calls `passport.authenticate(..., { session: false })`, which runs the composite Passport strategy for protected API requests.
3. **Composite Passport strategy** — For each IdP in `IDP_PLUGINS`, run that IdP’s auth middleware (typically verify JWT with JWKS, issuer/audience, or validate against the provider API). First IdP that sets `req.idpPluginCode` and `req.authPayload` wins; if none succeed, respond 401. `session: false` is intentional because the API is bearer-token based, stays stateless across requests, scales cleanly across instances, and remains compatible with trying multiple IdP plugins in order.
4. **resolveActor** — Uses the winning IdP’s `claimMapper.mapPayload(req.authPayload)` to get subject, profile, and optional `sobaAdmin`. Reads the identity provider, the identity, its stored attributes and the SOBA admin row in one query (`findSignInState`, called from `resolveSignedInActor`). Creates the app user with `findOrCreateUserByIdentity(...)` only for an identity not seen before, writes the IdP attributes or the admin row only when the token differs, and sets `req.actorId` and `req.isSobaAdmin`. Any failure (e.g. unknown IdP, missing payload) goes to error handler.
5. **Downstream** — Handlers use `req.actorId` and `req.isSobaAdmin`; core context middleware can attach workspace etc. for domain routes.

Auth-related env: `IDP_PLUGINS`, `IDP_PLUGIN_DEFAULT_*`, and per-IdP `PLUGIN_<IDP>_*` (e.g. JWKS URI, issuer, audience). Protected API auth is Passport-backed and stateless; IdP plugins still perform provider-specific verification and claim mapping.

### Enable/Disable features, add codes + roles for feature

- **Feature status:** Rows in `soba.feature` have a `status` column; values come from `soba.feature_status` (e.g. `enabled`, `disabled`, `experimental`, `deprecated`). Application code uses `isFeatureEnabled(status)` (e.g. in `featureRepo`) so only `enabled` is treated as on. Seed inserts core feature rows and status codes; to add a feature, add a row to `feature` and (if needed) to `feature_status` (with `source = 'core'` or the feature code).
- **Adding codes:** Code tables (e.g. `form_status`, `form_version_state`, `workspace_membership_role`, `feature_status`) use composite `(code, source)`. Core uses `source = 'core'`. To add codes for a feature: insert into the appropriate code table with `source = '<feature_code>'`. Seed and app code should use constants from a single place (e.g. `backend/src/core/db/codes/`) for core codes.
- **Adding roles for a feature:** Table `soba.role` has `source` and `feature_code`. Core roles have `source = 'core'`. To add a feature-specific role: insert with `source = 'feature'` and `feature_code = '<feature_code>'`. Role listing/filtering (e.g. in meta or roleRepo) can filter by source or feature so the UI only shows applicable roles.

### App structure (frontend)

- **Root layout** (`app/layout.tsx`): Minimal — html/body, globals.css. No providers here so the tree stays simple.
- **Locale layout** (`app/[lang]/layout.tsx`): Wraps all `[lang]` routes. Loads dictionary and features meta server-side, provides `DictionaryProvider`, renders `Header`, `SideNav`, `<main>{children}</main>`, and `Footer`. For signed-in users, SideNav shows Forms and Workspaces when `design-mode` is allowed, then My Forms and My Submissions when `submit-mode` is allowed, then Administration for SOBA admins. Feedback and Help always show.
- **Folders:** `app/ui/` - shared UI (Header, SideNav, Footer, forms). `lib/` - Redux store, slices, hooks, Keycloak init, runtime config. `src/features/` - admin, designer, formio-v5, onboarding, submit-mode, workspaces. `src/shared/` - API client, config, feature flags. `src/app/` - providers and routing. Use `@/lib`, `@/app`, `@/src` for imports.

### Runtime config (frontend)

- **Load:** `loadFrontendRuntimeConfig()` fetches `GET {baseUrl}/meta/frontend-config`; baseUrl comes from `NEXT_PUBLIC_SOBA_API_BASE_URL` until config is loaded. Called from the locale layout server-side (for the footer version) and from Keycloak init client-side. Result is cached in memory; subsequent calls return the cache.
- **Shape:** Config includes `auth.keycloak` (url, realm, clientId, pkceMethod), `api.baseUrl`, `build` (name, version, gitSha). Use `getSobaApiBaseUrl()` for API calls; use config.auth in Keycloak constructor. `getSobaApiBaseUrl()` returns the internal URL on the server — `api.baseUrl` is the browser-facing route and is not reachable from inside the cluster.

### Auth flow (frontend)

1. **Page load** — A client component (e.g. Header) mounts and dispatches `initKeycloak()`. That thunk calls `loadFrontendRuntimeConfig()`, then creates Keycloak and runs `kc.init({ onLoad: 'check-sso', ... })`. No redirect if session exists; token and authenticated state are stored in Redux.
2. **Login** — User clicks login; dispatch `login()` which calls `kc.login()`. Keycloak redirects to IdP and back; on return, token is available and Redux is updated.
3. **After authenticated** — Header sees `authenticated && token`, dispatches `loadCurrentUser(token)` and `loadWorkspaces(token)`, and shows display name, workspace switcher, and logout.
4. **Logout** — Dispatch `clearCurrentUser()` then `logout()`; Keycloak clears session and optionally redirects.

### Current user flow (frontend)

- When Keycloak reports authenticated and we have a token, dispatch `loadCurrentUser(token)`. The thunk calls `fetchCurrentUser(token)` (GET /me with Bearer token) and stores the result in `currentUser` slice (data, status: succeeded/failed).
- Header (and any component that needs the backend user) uses `useCurrentUser()` and compares `currentUser.token` to the current Keycloak token so we refetch when the token changes. On logout, dispatch `clearCurrentUser()` so no stale user data remains.
- Display name: prefer backend `/me` response (actor/profile); fall back to Keycloak id token claims (e.g. display_name) when current user is still loading or not yet fetched.

### Redux store shape (frontend)

- **keycloak:** token (string | undefined), idTokenParsed, authenticated (boolean), initializing, error. Keycloak instance is not in state (non-serializable); it’s held in a module variable and accessed via getKeycloakInstance().
- **currentUser:** data (CurrentUserResponse | null), status (idle | loading | succeeded | failed), error, lastToken. Cleared on logout; set by loadCurrentUser.fulfilled.
- **workspace:** workspaces (WorkspaceItem[]), activeWorkspaceId, status, error. Loaded after auth; auto-selects personal workspace when none active. Cleared on logout via `clearWorkspaceState`.
- **notification:** Toast/notification state (used by useNotificationStore and NotificationToast). Use useAppDispatch / useAppSelector with RootState for typing.

### API layer (frontend)

- **Base URL:** From `getSobaApiBaseUrl()` in `src/shared/config/runtimeConfig.ts` (cached config or `NEXT_PUBLIC_SOBA_API_BASE_URL`).
- **Pattern:** Protected calls set `Authorization: Bearer ${token}`. Form/submission helpers in `sobaApiForms.ts` also send **`x-workspace-id`** when a workspace is selected. Use fetch with cache: 'no-store' for dynamic data. Types for responses live in sobaApi.ts / sobaApiForms.ts.

### Testing

- **Goals:** Test **outcomes and logic** with minimal mocks. Prefer unit tests for services and pure functions; use **supertest** for a small set of **basic API scenarios** (e.g. validation, error responses). Leave broader **API-level and E2E** coverage to the **integration** app (Playwright) to reduce reliance on mocking infrastructure (DB, Form.io, IdP).
- **Backend:** Jest; tests under `backend/tests/` (e.g. `tests/core/api/shared/validation.test.ts`, `validation.supertest.test.ts`). Structure mirrors `src/` where it helps. Mock only what’s necessary (e.g. env reader, single adapter); avoid mocking the whole container or DB when a focused unit test will do.
- **Supertest:** Used for route-level checks without starting the full app: build a minimal Express app that mounts the middleware or router under test, then `request(app).get(...).set(...).send(...)` and assert status and body. Example: `validateRequest` middleware — create an app that uses it and assert 400 on invalid body/params/query and 200 with parsed values on valid input. Keep supertest tests to **basic scenarios** (validation, auth rejection, success path for one route); deeper flows belong in integration tests.
- **Frontend:** Vitest (see [Frontend](#frontend)). Integration: Playwright in the `integration` app for full API and UI flows.
