# BPMCore Architecture Notes

Use this file as the quick architecture source before changing the project.

## Naming

- Always write BPM in uppercase.
- The backend runtime app is `apps/api`.
- The reusable BPM package boundary is `libs/bpm-core`, exposed as
  `@rytass/bpm-core-nestjs-module`; `@bpm/core` is only an internal path alias.
- Do not reintroduce `apps/bpm-demo-host` or `@bpm/api/*`.

## Project Boundaries

- `apps/api`: NestJS host shell only. It wires Vault, TypeORM, GraphQL, CORS, validation, exception filters, health checks, DB-backed test-member login/session endpoints, wrapper-app seeding, and `BPMRootModule`.
- `libs/bpm-core`: reusable BPM backend core. Put BPM domain modules, entities, resolvers, mutations, services, migrations, auth contracts, and TypeORM helpers here.
- `apps/client`: Next.js backoffice UI. On localhost it uses `http://localhost:17603/graphql` and `http://localhost:17603/api`; on deployed hosts it defaults to same-origin `/graphql` and `/api`.
- `libs/shared`: shared BPM contracts for workflow, form, condition, identity, organization, and status types.

## Auth Model

BPMCore does not own login, token issuance, or a user table. The host app must provide:

- a `BPMAuthContext` source through GraphQL/HTTP context or `BPMRootModule` `authContextFactory`
- a `BPM_MEMBER_RESOLVER` provider

There is no mock auth fallback in `@rytass/bpm-core-nestjs-module`. The test accounts in `apps/api` are DB-backed wrapper-app simulation data in `api_test_members`, seeded by `pnpm demo:reset` / `pnpm staging:reset`, and are not part of the reusable BPM module.

## Development

Normal local runtime:

```bash
pnpm api
pnpm client
```

Use `pnpm demo:reset` before local scenario testing when the develop schema
needs a clean Taiwan manufacturing seed.

Normal verification:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e:client
```

`docker compose` is not required for normal development. Use Vault-backed develop secrets and `bpm_core/develop` unless the user explicitly asks otherwise.

Staging wrapper-host runtime secrets include `API_SESSION_SECRET`,
`BPM_API_PUBLIC_URL`, and `BPM_ATTACHMENT_SIGNING_SECRET`; the API host passes
the BPM attachment values into `BPMRootModule`.
