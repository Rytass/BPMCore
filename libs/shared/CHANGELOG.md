## 0.7.0 (2026-08-10)

### 🚀 Features

- **shared:** add business-day SLA and required return comment contracts ([584acd7](https://github.com/Rytass/BPMCore/commit/584acd7))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5 (1M context)

# Changelog

All notable changes to `@rytass/bpm-core-shared` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Added versioned form option-source, direct binding, selection-mode, and
  persisted label-snapshot contracts.
- Added `autocomplete` fields plus pure option-field guards and legacy schema
  normalization.

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.6.0 — 2026-08-04

### Added

- **`preferClosestOrgUnit` optional flag** on the `ORG_MANAGER` and
  `ORG_UNIT_MANAGER` variants of `ApproverResolver`. When enabled, the
  workflow engine resolves only the deepest org-unit-level manager rules
  on the winning priority tier, so ancestor-level catch-all rules do not
  dilute the approver list. Defaults to `false` (unchanged behavior).
  `parseApproverResolver` in `workflow-toolset.ts` parses the new field.

### Why a minor

New optional type field — backward compatible, additive.

## 0.5.1 — 2026-07-06

### Fixed

- **Broken 0.5.0 tarball.** 0.5.0 was published from the project source root, so
  the npm tarball shipped only TypeScript sources with no compiled `.js`/`.d.ts`
  while `main`/`exports` point at `./src/index.js`. 0.5.1 is republished from the
  build output (`dist/libs/shared`). Configured `nx-release-publish` with
  `packageRoot: dist/libs/shared`. No source changes.

## 0.5.0 — 2026-07-06

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.5.0 (fixed release group). The new
`BPMMemberSearchPage` paged-search types added in that release live in
`@rytass/bpm-core-nestjs-module`, not here.

## 0.4.0 — 2026-07-02

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.4.0 (fixed release group).

## 0.3.0 — 2026-06-06

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.3.0 (fixed release group).

## 0.2.0 — 2026-06-04

No source change. Lockstep bump with `@rytass/bpm-core-nestjs-module`
and `@rytass/bpm-core-client` 0.2.0.

## 0.1.10 — 2026-05-28

No source change. Lockstep bump.

## 0.1.9 — 2026-05-28

No source change. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.9` (machine-to-machine auth +
nested AuthProvider docs) and `@rytass/bpm-core-client@0.1.9`
(`OrgUnitType` is now a re-export from this package, not a separate
definition — see that CHANGELOG).

## 0.1.8 — 2026-05-28

No source change. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.8` (README drift fixes for Casbin
example, position signatures, and metadataJson write-only clarification).

## 0.1.7 — 2026-05-28

### ⚠️ Type-level breaking (consumers writing literal values)

- **`OrgUnitType` literal case corrected**: was `'company' | 'division'
  | 'department' | 'team'` (lowercase, matched the database row values
  but **not** the GraphQL SDL); now `'COMPANY' | 'DIVISION' |
  'DEPARTMENT' | 'TEAM'` (UPPERCASE, matches what the GraphQL wire
  actually carries on every read and every write).

  Consumers calling `createOrgUnit({ type: 'company' })` against the
  published `@rytass/bpm-core-client@0.1.6` or earlier received a
  GraphQL enum-coercion error at runtime — the lowercase form was
  rejected by the BPM server. The TS type was misleading. This release
  realigns the type with the wire reality.

  Migration: update any literal `'company'` / `'division'` /
  `'department'` / `'team'` passed to `createOrgUnit` / `updateOrgUnit`
  / `readOrganizationDashboard` `orgUnitType` filter to the UPPERCASE
  form. JSDoc on the type explains the casing.

### Documentation

- JSDoc added to `OrgUnitType` explaining the lowercase database value
  vs UPPERCASE wire format asymmetry.

### Why a patch (despite the rename)

The lowercase form did not work in practice — any consumer who got
past `tsc` failed at runtime against the GraphQL server. Calling this a
patch reflects "fixing a documented contract" rather than "changing
working behavior".

## 0.1.6 — 2026-05-28

No source changes. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.6` (new `MemberNotFoundException`
export) and `@rytass/bpm-core-client@0.1.6` (new `configureBPMClient`).

## 0.1.5 — 2026-05-28

### Documentation

- **`MemberMetadata.customFields` JSDoc.** Documented as opaque
  host-shaped JSON: BPM stores the object verbatim, serializes it back
  to GraphQL clients via `MemberProfile.customFieldsJson`, and never
  introspects keys. Hosts populate the field via the
  `options.readCustomFields?.(member)` hook in
  `createBPMMemberBaseResolverProvider`. This was previously implied by
  the source but undocumented in the published JSDoc.

### Why a patch

No public type signatures change. JSDoc only.

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

- Initial published surface: workflow, form, condition, identity,
  organization, and status type contracts under
  `@rytass/bpm-core-shared` plus per-domain subpaths (`/condition`,
  `/form`, `/status`, `/workflow`).
