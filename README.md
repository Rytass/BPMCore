# BPM

Internal BPM approval engine workspace.

## Current Architecture

This repository is an Nx integrated monorepo. The important boundary is:

- `apps/api` is the NestJS host application. It owns runtime wiring: Vault,
  TypeORM, GraphQL, HTTP auth/session endpoints, DB-backed test-member login,
  CORS, validation pipe, exception filter, health checks, migrations at deploy,
  and wrapper-app reset/seeding commands.
- `libs/bpm-core` is the embeddable BPM package boundary exposed as
  `@rytass/bpm-core-nestjs-module`. It owns BPM domain modules, GraphQL
  resolvers/mutations, entities, migrations, TypeORM helpers, auth contracts,
  and `BPMRootModule`.
- `apps/client` is the Next.js backoffice UI. It talks to `apps/api` through
  GraphQL and `/api/auth/*`.
- `libs/shared` owns frontend/backend shared BPM contracts such as workflow,
  form, condition, identity, organization, and status types.

Do not put BPM domain behavior back into `apps/api`. Future reusable backend
work belongs in `libs/bpm-core`; `apps/api` should stay a thin host shell that
imports `BPMRootModule` from `@rytass/bpm-core-nestjs-module`.

## Runtime Relationship

Local development uses two processes:

- API: `apps/api`, served by `pnpm api`, default
  `http://localhost:17603/api`.
- GraphQL: served by `apps/api` at `http://localhost:17603/graphql`.
- Client: `apps/client`, served by `pnpm client`, default
  `http://localhost:17602`.

The client endpoint resolver is host-aware:

- Browser hostname `localhost` or `127.0.0.1`: GraphQL defaults to
  `http://localhost:17603/graphql`; auth defaults to
  `http://localhost:17603/api`.
- Deployed hostnames: GraphQL defaults to same-origin `/graphql`; auth defaults
  to same-origin `/api`.
- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_API_AUTH_URL` can override these
  defaults when an external deployment needs a split API host.

The browser client does not read a plain `API_URL` environment variable for
endpoint resolution. Use the `NEXT_PUBLIC_*` variables above when the browser
must call a different API origin.

Staging is deployed at:

- Client: `https://bpm-core-staging.rytass.info/`
- API: `https://bpm-core-staging.rytass.info/api`
- GraphQL: `https://bpm-core-staging.rytass.info/graphql`

The staging ingress routes `/api` and `/graphql` to the API container and all
other paths to the client container. The GitHub Actions `Staging Server`
workflow builds both images, runs migrations in the API init container, applies
`tools/deployment-staging.yml`, and waits for the GKE rollout. The checked-in
manifest declares Traefik routing; TLS termination is provided by the surrounding
cluster/ingress configuration.

The API uses Vault-backed configuration by default. Local development should
use the configured shell Vault environment and the `bpm_core/develop` Vault
path. Staging uses `bpm_core/staging`. `docker compose` is not part of the
required development or verification flow.

The staging API also expects Kubernetes runtime secrets for the wrapper host:
`API_SESSION_SECRET`, `BPM_API_PUBLIC_URL`, and
`BPM_ATTACHMENT_SIGNING_SECRET`. The latter two are passed into `BPMRootModule`
so attachment download/preview signed URLs use the public staging origin instead
of the local development fallback.

## Backend Embedding Contract

External NestJS systems should consume `@rytass/bpm-core-nestjs-module` and
import `BPMRootModule` in their root module. The host system is responsible for:

- GraphQL module setup.
- TypeORM connection setup.
- Vault/secret configuration.
- Login/session/JWT handling.
- `BPMAuthContext` creation.
- `BPM_MEMBER_RESOLVER` provider implementation.
- Attachment storage, public signed URL prefix, and signing secrets.
- Notification delivery worker or `BPM_NOTIFICATION_DISPATCHER` integration.

`@rytass/bpm-core-nestjs-module` does not own a user table and does not provide
mock auth fallback. It stores member ids and resolves member profiles through
the host-provided resolver. In-process delivery and SLA schedulers are off by
default so API replicas can embed the module without accidentally running
duplicate worker loops.

## Wrapper App Auth And Seed Data

This repository's `apps/api` host shell provides DB-backed simulation accounts
for local/staging evaluation. The accounts live in the wrapper-app table
`api_test_members`; they are not part of `libs/bpm-core` and should not be
treated as a production identity system.

Runtime auth endpoints:

- `GET /api/auth/test-members`: lists available DB-backed test accounts.
- `POST /api/auth/login`: writes the signed HTTP-only session cookie.
- `GET /api/auth/me`: reads the current session member.
- `POST /api/auth/logout`: clears the session cookie.

Reset/seeding commands:

```bash
pnpm demo:reset
pnpm staging:reset
```

`pnpm demo:reset` uses the develop Vault path. `pnpm staging:reset` uses
`bpm_core/staging`. Both commands are destructive for the target schema and
seed a Taiwan manufacturing scenario with org units, positions, test members,
memberships, manager rules, form definitions, approval templates, instances,
tasks, notifications, attachments, signatures, and delegations.

## Local Commands

```bash
pnpm install
pnpm demo:reset
pnpm dev
```

`pnpm demo:reset` runs migrations before resetting and seeding develop data. Use
`pnpm migration:run` separately only when you need migrations without resetting
the seed scenario.

`pnpm dev` launches both long-running dev servers — `pnpm api`
(http://localhost:17603/graphql) and `pnpm client` (http://localhost:17602) —
in a single tiled **tmux** session (`scripts/dev-tmux.sh`). Re-running attaches
to the existing session; stop everything with `tmux kill-session -t bpm-core-dev`.
Prefer separate terminals (or no tmux)? Run `pnpm api` and `pnpm client`
individually instead.

## Designer AI Assistant

The flow designer page ships an optional LLM chat assistant: describe a workflow
in natural language and it draws/edits it on the canvas through the shared
workflow toolset. It is hidden by default; enable it per deployment with
`BPM_AI_ASSISTANT_ENABLED=true` + `OPENAI_API_KEY` on the Next.js client host
(locally, `apps/client/.env.local`). See
[docs/12-ai-assistant.md](./docs/12-ai-assistant.md) for usage, architecture,
env vars, and deployment.

## Verification

Repository-wide checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Useful focused checks:

```bash
pnpm nx typecheck api
pnpm nx test api --runInBand
pnpm nx build api --skip-nx-cache
pnpm nx typecheck client
pnpm nx test client --runInBand
pnpm nx build client --skip-nx-cache
pnpm nx build bpm-core --skip-nx-cache
```

Client e2e requires running services:

```bash
pnpm api
pnpm client
pnpm e2e:client
```

By default Playwright uses `http://localhost:17602` as `E2E_BASE_URL`; override
it only when intentionally testing another deployed URL.

## Planning Docs

The BPM planning documents are stored in [`docs/`](./docs/). Start from
[`docs/README.md`](./docs/README.md), then follow the numbered files for system
decisions, domain model, BPMN engine rules, versioning, CEL conditions, data
model, execution behavior, frontend workflow schema, and roadmap.
