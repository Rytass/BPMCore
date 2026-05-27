# Changelog

All notable changes to `@rytass/bpm-core-react` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.3.5 — 2026-05-28

No source change. Lockstep peerDependency bump to `^0.1.8`.

## 0.3.4 — 2026-05-28

### Documentation

- **README "Mounting BPM under a non-root URL prefix"** added. Shows
  the exhaustive `createPrefixedRoutes(prefix)` factory covering all
  **19** `BPMRoutes` entries (previously the README only sketched
  2-3). Spreading `createDefaultBPMRoutes()` first means new BPMCore
  versions that add routes never silently regress consumer hosts.

### Why a patch

Documentation-only. No source change.

## 0.3.3 — 2026-05-28

### Fixed

- **Dist `.d.ts` files leaked workspace-source paths.** The 0.3.0–0.3.2
  release shipped declaration files that contained relative imports back
  into the vendor's monorepo (e.g. `import { ApiMember } from
  '../../libs/bpm-core-client/src/index.ts'`), which broke `tsc` for any
  consumer that didn't have BPMCore's source on disk at that exact
  relative path. The build now passes `compilerOptions.paths: {}` to
  `vite-plugin-dts` so the published types reference packages by their
  npm names (`@rytass/bpm-core-client`) rather than by resolved aliases.

### Added

- **`BPMNextProviders` props are now typed and forwarded.** The
  `loginPath`, `publicPaths`, and `locale` props were always accepted by
  the inner `<Providers>` but the `next` subpath wrapper hid them. They
  are now part of the exported `BPMNextProvidersProps` interface and
  forwarded through. Default `loginPath` remains `'/login'`, so hosts
  with a different auth route must pass their override explicitly.

### Documentation

- `BPMRoutes.caseDetail` and `BPMRoutes.caseNew(templateId?)` JSDoc
  carries `@example` annotations showing the default factory's literal
  paths so consumers can see what they're overriding without reading
  the source.

### Why a patch

The d.ts fix only affected consumers' type-check experience — runtime
behavior didn't change. The `BPMNextProviders` props forwarding is
additive (props were silently dropped before, now they work).

## 0.3.2 — 2026-05-28

### Added

- **`BPMRoutesContext` + `BPMRoutesProvider` + `useBPMRoutes()`** — opt-in
  path-mapping for hosts that embed BPM views under their own URL prefix.
  All BPM internal cross-navigation (instance detail, instance new,
  template designer, template versions, template categories, form
  builder, etc.) now resolves through `routes.caseDetail(id)` instead of
  inline `\`/instances/${id}\``. When no provider is mounted,
  `createDefaultBPMRoutes()` reproduces the previous string literals so
  upgrades from 0.3.1 require zero changes.

  Re-exported from the root barrel and from `@rytass/bpm-core-react/next`.

  Example (Next.js host mounting BPM under `/workspace`):

  ```tsx
  import { BPMRoutesProvider } from '@rytass/bpm-core-react/next';

  <BPMRoutesProvider value={{
    caseDetail: (id) => `/workspace/cases/${id}`,
    caseNew: (templateId) =>
      `/workspace/cases/new${templateId ? `?t=${templateId}` : ''}`,
    templates: () => '/workspace/templates',
    templateDesigner: (id) => `/workspace/templates/${id}/designer`,
    // ...rest follows the BPMRoutes interface
  }}>
    {children}
  </BPMRoutesProvider>
  ```

### Why a patch (additive only)

The provider is optional and the default factory preserves the exact
0.3.1 routes. No public symbol removed, no existing type signature
changed.

## 0.3.1 — 2026-05-27

### Fixed

- **`AppLayout` slot detection — the "left sidebar disappeared" bug.**
  Mezzanine `<Layout>` discovers its sidebar slot by component-identity
  match (`child.type === Navigation`). The previous `<AppNavigation>`
  wrapper rendered `<Navigation>` internally, so `<Layout><AppNavigation
  />...</Layout>` would silently drop the sidebar because `AppNavigation`
  ≠ `Navigation`. This shipped in 0.3.0 and broke every embedded view.

### ⚠️ Breaking

- **`AppNavigation` → `AppLayout`.** The standalone navigation component
  is replaced by `AppLayout`, which composes Mezzanine's
  `<Layout> + <Navigation> + <Layout.Main>{children}</Layout.Main>`
  internally. All 12 internal views were migrated.

  Migration for consumers who imported `AppNavigation` directly (very
  rare — most consume the `pages/*` shims which already use `AppLayout`):

  ```diff
  - import { AppNavigation } from '@rytass/bpm-core-react';
  + import { AppLayout } from '@rytass/bpm-core-react';

  - <Layout>
  -   <AppNavigation activeHref="/inbox" />
  -   <Layout.Main>
  -     <PageHeader title="待簽" />
  -     <SectionGroup>...</SectionGroup>
  -   </Layout.Main>
  - </Layout>
  + <AppLayout activeHref="/inbox">
  +   <PageHeader title="待簽" />
  +   <SectionGroup>...</SectionGroup>
  + </AppLayout>
  ```

  The exported types are now `AppLayoutProps` and `AppNavigationGroup`
  (the latter is the typed shape for overriding the 4-group nav tree via
  the `groups` prop).

## 0.3.0 — 2026-05-27

### Added

- **Full admin surface.** Up from the 0.2.0 login-only POC to 12 view
  subpaths, 19 Next.js page shims (`pages/<feature>`), and 4 view group
  barrels (`views/workflow`, `views/instances`, `views/settings`,
  `views/admin`).
- **`@rytass/bpm-core-react/next` subpath** — `<BPMNextProviders>`
  composes RouterAdapter + AuthProvider + NotificationDrawerProvider +
  NotificationUnreadProvider + CalendarConfigProviderMoment in one wrap.
- **Root barrel foundation** — Providers, hooks (`useAuth`,
  `useRouterAdapter`, `useNotificationUnread`,
  `useNotificationDrawer`), `AppNavigation`, `NotificationDrawer`,
  `ApprovalInstanceListPage`, `DashboardPage`, `BPMFormField`,
  `MemberPicker`, `OrgUnitPicker`, `PositionPicker`.

### Changed

- **Server Components everywhere by default.** `pages/<feature>` modules
  are now Server Components that export `default` + `metadata`. The
  `'use client'` boundary lives inside the underlying `<F>View`. The
  prior intermediate `<F>ClientView` shim layer (19 files) is removed.
- **`InstanceNewView` lifts `searchParams` to a prop.** Pages read
  `searchParams.templateId` server-side and pass it down instead of the
  view reading the browser URL.
- **Root page `/` performs a server-side redirect to `/dashboard`** for
  authenticated users (previously a client-side bounce).

## 0.2.0 — 2026-05-26

### Added

- Initial POC release. Login chain only (`/views/login`, `/pages/login`,
  providers, RouterAdapter). The remaining views planned for 0.3.0.
- Vite library-mode build pipeline emitting per-format chunks
  (`.js` for ESM, `.cjs` for CJS), SCSS CSS Modules with `bpm_` scope
  prefix, `'use client'` directive preserved via
  `rollup-preserve-directives`, type definitions via `vite-plugin-dts`.
- Decoupled from `next/navigation` via the `RouterAdapter` context —
  framework-agnostic consumers can plug in their own router.
