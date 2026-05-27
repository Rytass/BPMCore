# Changelog

All notable changes to `@rytass/bpm-core-shared` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

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
