# Changelog

All notable changes to `@rytass/bpm-core-client` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.1.7 — 2026-05-28

### Documentation

- README "Current version" line refreshed to `0.1.7`.
- Org example continues to compile against the updated `OrgUnitType`
  (UPPERCASE) — see `@rytass/bpm-core-shared@0.1.7` CHANGELOG for the
  type-level change.

### Why a patch

No source change. Lockstep bump.

## 0.1.6 — 2026-05-28

### Added

- **`configureBPMClient({ baseUrl, authBaseUrl, fetch, headers })`**.
  Server-side Node scripts (cron workers, org seeds, integration tests)
  can now override the GraphQL endpoint, REST auth base URL, fetch
  implementation, and default request headers programmatically without
  relying on `NEXT_PUBLIC_API_URL` environment resolution. Both the
  `requestGraphQl` GraphQL transport and the REST auth client honor the
  override. Browser consumers under Next.js typically still rely on
  `NEXT_PUBLIC_API_URL` and do not need to call this.

  ```ts
  import { configureBPMClient } from '@rytass/bpm-core-client';

  configureBPMClient({
    baseUrl: 'https://api.shuttle.example.com',
    headers: { 'X-Service-Token': process.env.BPM_SYNC_TOKEN ?? '' },
  });
  ```

### Documentation

- README "Organization Mirror Pattern" rewritten with the correct
  flat-input API shape (`updateOrgUnit({ id, code, name, type,
  parentId, metadataJson })`, not the `{ id, input: {...} }` form the
  0.1.5 example incorrectly showed). Adds a "Server-side base URL
  override" section pointing at `configureBPMClient`.

### Why a patch

`configureBPMClient` is purely additive. Existing callers see no
change to behavior unless they call the new API.

## 0.1.5 — 2026-05-28

### Documentation

- **README "Organization mirror pattern" section.** Condensed pointer to
  the full pattern in `@rytass/bpm-core-nestjs-module`'s README plus a
  client-side worked example using `createOrgUnit`, `updateOrgUnit`,
  `deleteOrgUnit`, `commitOrgUnitTreeDraft`, `createPosition`,
  `createMembership`, `createManagerResolution`. Clarifies that BPM owns
  the org graph and host applications mirror their existing org data in
  rather than expose a resolver (in contrast to the member-resolver
  pattern).

### Why a patch

No type or runtime change. README only.

## 0.1.4 — 2026-05-27

No source changes. Bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.4` (re-publish after the 0.1.3
backend tarball shipped only `.ts` source — see that package's CHANGELOG).

## 0.1.3 — 2026-05-27 (deprecated on npm)

Lockstep bump alongside the broken 0.1.3 backend release. Avoid;
upgrade directly to 0.1.4 or newer.

## 0.1.2 — 2026-05-27

No source changes. Bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.2` (see its CHANGELOG for the
migration class-name fix).

## 0.1.1 — 2026-05-27

No source changes. Version bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.1` so the fixed-versioning release
group stays aligned (see `nx.json` `release.projectsRelationship`).

## 0.1.0 — Unreleased

### Added

- Initial published surface extracted from `apps/client` of the BPMCore
  monorepo:
  - Root: `requestGraphQl`, endpoint resolvers, REST auth client (`loginApi`,
    `logoutApi`, `readApiCurrentMember`, `listApiTestMembers`), member
    directory queries (`resolveMembers`, `searchMembers`,
    `listMemberDirectoryPage`).
  - `/organization`: org unit / position / membership / manager resolution
    queries and mutations.
  - `/form`: form definition CRUD, version management, schema rendering
    helpers.
  - `/template`: approval template CRUD, category management, version
    publish / rollback.
  - `/workflow`: instance / task / notification / attachment / signature
    operations.
- Endpoint defaults: `http://localhost:17603/graphql` on local hostnames,
  same-origin `/graphql` on deployed hostnames, plus root-level
  `/auth/*` (no `/api` prefix). Overridable through `NEXT_PUBLIC_API_URL`
  and `NEXT_PUBLIC_API_AUTH_URL`.

### Notes

- `@rytass/bpm-core-shared` is a `peerDependency` (`^0.1.0`).
- The package ships without `"type"` at source level so Next.js webpack
  resolving the path alias to TypeScript source does not flag CJS / ESM
  conflicts; the publish pipeline injects `"type": "commonjs"` into the
  tarball's `package.json`.
