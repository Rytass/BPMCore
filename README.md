# BPM

Internal BPM approval engine workspace.

## Current Architecture

This repository is an Nx integrated monorepo. The important boundary is:

- `apps/api` is the NestJS host application. It owns runtime wiring: Vault, TypeORM, GraphQL, HTTP auth/session endpoints, CORS, validation pipe, exception filter, and health checks.
- `libs/bpm-core` is the embeddable BPM package boundary exposed as `@rytass/bpm-core-nestjs-module`. It owns BPM domain modules, GraphQL resolvers/mutations, entities, migrations, TypeORM helpers, auth contracts, and `BPMRootModule`.
- `apps/client` is the Next.js backoffice UI. It talks to `apps/api` through GraphQL and `/api/auth/*`.
- `libs/shared` owns frontend/backend shared BPM contracts such as workflow, form, condition, and status types.

Do not put BPM domain behavior back into `apps/api`. Future reusable backend work belongs in `libs/bpm-core`; `apps/api` should stay a thin host shell that imports `BPMRootModule` from `@rytass/bpm-core-nestjs-module`.

## Runtime Relationship

For local development and staging, the service pair is:

- API: `apps/api`, served by `pnpm api`, default `http://localhost:17603/api`
- Client: `apps/client`, served by `pnpm client`, default `http://localhost:17602`

The API uses Vault-backed configuration by default. Local development should use the configured shell Vault environment and the `bpm_core/develop` Vault path. `docker compose` is not part of the required development or verification flow.

## Backend Embedding Contract

External NestJS systems should consume `@rytass/bpm-core-nestjs-module` and import `BPMRootModule` in their root module. The host system is responsible for:

- GraphQL module setup
- TypeORM connection setup
- Vault/secret configuration
- login/session/JWT handling
- `BPMAuthContext` creation
- `BPM_MEMBER_RESOLVER` provider implementation

`@rytass/bpm-core-nestjs-module` does not own a user table and does not provide mock auth fallback. It stores member ids and resolves member profiles through the host-provided resolver.

## Local Commands

```bash
pnpm install
pnpm migration:run
pnpm api
pnpm client
```

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e:client
```

Useful focused checks:

```bash
pnpm nx build api --skip-nx-cache
pnpm nx build bpm-core --skip-nx-cache
```

## Planning Docs

The BPM planning documents are stored in [`docs/`](./docs/). Start from [`docs/README.md`](./docs/README.md), then follow the numbered files for system decisions, domain model, BPMN engine rules, versioning, CEL conditions, data model, execution behavior, frontend workflow schema, and roadmap.
