# Changelog

All notable changes to `@rytass/bpm-core-nestjs-module` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.1.2 — 2026-05-27

### Fixed

- **First migration class-name suffix collision with TypeORM timestamp
  validation.** `EnablePostgresExtensions0000000000000` from 0.1.1
  parsed to a JavaScript timestamp of `0`, which TypeORM 0.3's
  `MigrationExecutor.getMigrations()` rejects with
  `migration name is wrong. Migration class name should have a JavaScript
  timestamp appended.` (the check is `!timestamp || isNaN(timestamp)`).
  Renamed to `EnablePostgresExtensions0000000000001` (timestamp `1`).
  The file was also renamed
  `0000000000000-enable-postgres-extensions.ts` →
  `0000000000001-enable-postgres-extensions.ts` so file ordering still
  matches class ordering.

  Consumers on 0.1.0 / 0.1.1 should upgrade directly to 0.1.2.

## 0.1.1 — 2026-05-27

### Fixed

- **Migration class-name suffix consistency.** Seven migrations
  (`EnablePostgresExtensions`, `IdentityOrganizationFoundation`,
  `FormBuilderFoundation`, `ApprovalTemplateFoundation`,
  `WorkflowEngineFoundation`, `ApprovalTemplateCategories`,
  `TaskCandidates`) previously used 13-digit date suffixes
  (`...2026050404000`) while the remaining seven used sequence suffixes
  (`...0000000005000`). TypeORM's `MigrationExecutor` sorts by the
  trailing numeric tail of the class name, so date-suffixed migrations
  ran AFTER sequence-suffixed ones — producing
  `relation "approval_instances" does not exist` when
  `NotificationsSla0000000006000` tried to FK-reference a table that
  `WorkflowEngineFoundation2026050404000` would only create later.

  All 14 migration classes now use the sequence suffix that matches the
  file-name prefix (`EnablePostgresExtensions0000000000000` …
  `WorkflowQueryIndexes0000000013000`). Array order in
  `BPM_CORE_MIGRATIONS` is unchanged.

  **Breaking for fresh deployments only**: the migration bookkeeping
  table records class names, so consumers upgrading from 0.1.0 in a
  production database would see the renamed migrations as "pending"
  again. Since 0.1.0 is a same-week release and there are no recorded
  production deployments yet, no migration backfill is shipped. If a
  consumer needs to upgrade in place, manually
  `UPDATE migrations SET name = REPLACE(name, '2026...', '00000...')`
  in the migrations table to retain the executed state.

## 0.1.0 — Unreleased

### Added

- Initial published surface: `BPMRootModule.forRoot` / `forRootAsync`,
  domain modules (identity, organization, form, template, workflow engine,
  delegation, notification, signature, attachment), TypeORM migrations
  (`BPM_CORE_MIGRATIONS`), GraphQL resolvers, and shared host contracts
  (`BPMAuthContext`, `BPMMemberResolver`, `ATTACHMENT_STORAGE`,
  `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER`, `BPM_NOTIFICATION_DISPATCHER`).
- Role / permission contract (`BPM_ADMIN`, `BPM_DESIGNER`, plus permission
  string sets) enforced by `BPMAdminGuard` and `BPMDesignerGuard`, with
  `BPMAuthenticated()`, `BPMAdminOnly()`, `BPMDesignerOnly()`,
  `BPMCurrentAuthContext`, and `BPMCurrentMemberId` decorators.
- Dynamic attachment controller path via `attachmentRoutePrefix` (no Nest
  `setGlobalPrefix` required).
- `AllExceptionsFilter` global Nest exception filter.

### Changed

- `@rytass/bpm-core-shared` is now a `peerDependency` (`^0.1.0`) so
  consumers manage shared version themselves.
- `@rytass/secret-adapter-vault-nestjs` moved to optional `peerDependency`,
  accepting `^0.4.5 || ^0.5.0`.
- `express` moved to optional `peerDependency`.
