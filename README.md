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
  GraphQL (`/graphql`) and the root-level REST auth endpoints (`/auth/*`).
- `libs/shared` owns frontend/backend shared BPM contracts such as workflow,
  form, condition, identity, organization, and status types.

Do not put BPM domain behavior back into `apps/api`. Future reusable backend
work belongs in `libs/bpm-core`; `apps/api` should stay a thin host shell that
imports `BPMRootModule` from `@rytass/bpm-core-nestjs-module`.

## Runtime Relationship

Local development uses two processes:

- API: `apps/api`, served by `pnpm api`, default `http://localhost:17603`.
  The API has no global prefix: GraphQL is at `/graphql`, and the REST auth
  and attachment endpoints are at the root (`/auth/*`, `/attachments/*`).
- Client: `apps/client`, served by `pnpm client`, default
  `http://localhost:17602`.

The client endpoint resolver is host-aware:

- Browser hostname `localhost` or `127.0.0.1`: GraphQL defaults to
  `http://localhost:17603/graphql`; auth defaults to `http://localhost:17603`
  (root-level `/auth/*`).
- Deployed hostnames: GraphQL defaults to same-origin `/graphql`; auth defaults
  to same-origin root paths (`/auth/*`).
- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_API_AUTH_URL` can override these
  defaults when an external deployment needs a split API host.

The browser client does not read a plain `API_URL` environment variable for
endpoint resolution. Use the `NEXT_PUBLIC_*` variables above when the browser
must call a different API origin.

Staging is deployed at:

- Client: `https://bpm-core-staging.rytass.info/`
- API (GraphQL and auth): `https://bpm-core-staging.rytass.info` (GraphQL at
  `/graphql`, auth at `/auth/*`, attachments at `/attachments/*`)

The staging ingress (`tools/deployment-staging.yml`, Traefik `IngressRoute`)
routes `/graphql`, `/auth` and `/attachments` to the API container and all
other paths to the client container. The GitHub Actions `Staging Server`
workflow builds both images, runs migrations in the API init container, applies
`tools/deployment-staging.yml`, and waits for the GKE rollout. Images are tagged
with the release tag `nx release` put on the pushed commit (`v0.17.7`), or
`sha-<short sha>` when it has none; the workflow never creates git tags, so it
cannot take a version from the next release. The checked-in
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
import `BPMRootModule` in their root module. Every `BPMRootModule` option has a
default — `BPMRootModule.forRoot()` boots — so the list below is what a real
deployment opts into, not a list of required arguments:

- GraphQL module setup.
- TypeORM connection setup.
- Vault/secret configuration.
- Login/session/JWT handling.
- `BPMAuthContext` creation.
- A member resolver, as the `memberResolver` runtime value or a `BPM_MEMBER_RESOLVER` provider. Without one BPM resolves each member to its own id.
- Versioned form option DataSource registry/provider through
  `BPM_FORM_DATA_SOURCE_REGISTRY`; the host owns provider authorization and source data.
- Attachment storage, public signed URL prefix, and signing secrets.
- Notification delivery worker or `BPM_NOTIFICATION_DISPATCHER` integration.

`@rytass/bpm-core-nestjs-module` does not own a user table and does not provide
mock auth fallback. It stores member ids and resolves member profiles through
the host-provided resolver. The in-process notification delivery and SLA
schedulers are off by default so API replicas can embed the module without
accidentally running duplicate worker loops. The NOTIFY webhook delivery
scheduler is the exception: it defaults to `auto` and starts as soon as a
webhook endpoint is configured (it claims rows, so replicas do not double-send).

## Wrapper App Auth And Seed Data

This repository's `apps/api` host shell provides DB-backed simulation accounts
for local/staging evaluation. The accounts live in the wrapper-app table
`api_test_members`; they are not part of `libs/bpm-core` and should not be
treated as a production identity system.

Runtime auth endpoints:

- `GET /auth/test-members`: lists available DB-backed test accounts.
- `POST /auth/login`: writes the signed HTTP-only session cookie.
- `GET /auth/me`: reads the current session member.
- `POST /auth/logout`: clears the session cookie.

`GET /auth/test-members` is registered unconditionally by the `apps/api` demo
host; it is not gated by `NODE_ENV`. The staging host runs with
`NODE_ENV=production` and depends on this endpoint, so it stays. A production
host that copies this shell must remove the endpoint or guard it itself.

Reset/seeding commands:

```bash
pnpm demo:reset
pnpm staging:reset
```

`pnpm demo:reset` uses the develop Vault path. `pnpm staging:reset` uses
`bpm_core/staging`. Both commands are destructive for the target schema and
seed a Taiwan manufacturing scenario with org units, positions, test members,
memberships, manager rules, form definitions, approval templates, instances,
tasks, notifications, attachments, signatures, delegations, and the dynamic
`demo.cost-centers@1` form-option fixture. The source table is wrapper-owned
and is not part of the reusable BPM migration list.

## Local Commands

```bash
pnpm install
pnpm demo:reset
pnpm dev
```

`pnpm demo:reset` runs migrations before resetting and seeding develop data. Use
`pnpm migration:run` separately only when you need migrations without resetting
the seed scenario.

`pnpm dev` starts the dev supervisor (`scripts/dev-supervisor.mts`). It runs
`pnpm api` (http://localhost:17603/graphql) and `pnpm client`
(http://localhost:17602) under one parent process, keeps per-service logs, and
reports service exits. After a code change, `pnpm dev:ctl restart <api|client>`
restarts one service without stopping the other (`scripts/dev-ctl.mts` documents
the exit codes).

`pnpm dev:tmux` is the separate tmux variant (`scripts/dev-tmux.sh`): both
servers in one tiled **tmux** session. Re-running attaches to the existing
session; stop it with `tmux kill-session -t bpm-core-dev`. Prefer separate
terminals (or no supervisor)? Run `pnpm api` and `pnpm client` individually.

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
