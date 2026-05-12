# BPMCore Architecture Notes

Use this file as the quick architecture source before changing the project.

## Naming

- Always write BPM in uppercase.
- The backend runtime app is `apps/api`.
- The reusable BPM package boundary is `libs/bpm-core`, imported as `@bpm/core`.
- Do not reintroduce `apps/bpm-demo-host` or `@bpm/api/*`.

## Project Boundaries

- `apps/api`: NestJS host shell only. It wires Vault, TypeORM, GraphQL, CORS, validation, exception filters, health checks, local demo member login/session endpoints, and `BPMRootModule`.
- `libs/bpm-core`: reusable BPM backend core. Put BPM domain modules, entities, resolvers, mutations, services, migrations, auth contracts, and TypeORM helpers here.
- `apps/client`: Next.js backoffice UI. It uses `http://localhost:17603/graphql` and `/api/auth/*` by default.
- `libs/shared`: shared BPM contracts for workflow, form, condition, and status types.

## Auth Model

BPMCore does not own login, token issuance, or a user table. The host app must provide:

- a `BPMAuthContext` source through GraphQL/HTTP context or `contextFactory`
- a `BPM_MEMBER_RESOLVER` provider

There is no mock auth fallback in `@bpm/core`. The demo accounts in `apps/api` are local host fixtures for development and e2e verification only.

## Development

Normal local runtime:

```bash
pnpm api
pnpm client
```

Normal verification:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e:client
```

`docker compose` is not required for normal development. Use Vault-backed develop secrets and `bpm_core/develop` unless the user explicitly asks otherwise.
