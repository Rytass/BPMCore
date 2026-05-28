# Changelog

All notable changes to `@rytass/bpm-core-react` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.4.1 — 2026-05-28

### Fixed

- **`<BPMNextProviders>` no longer breaks BPM views under Next.js 16 App
  Router prerender.** Previous versions wrapped the provider body in
  `<Suspense fallback={null}>` so that `useSearchParams()` could survive
  the static prerender phase. In Next 16, `useSearchParams()` triggers a
  client-side bailout at prerender time, the `<Suspense>` boundary then
  rendered `null`, and `<RouterAdapterProvider>` — which lived **inside**
  that boundary — vanished from the SSR/hydration tree. Every BPM view
  that called `useRouterAdapter()` on mount then threw
  `must be used inside <RouterAdapterProvider>` and Next.js surfaced the
  global error overlay.

  Fix: removed `useSearchParams()` from `BPMNextProviders` entirely. The
  `searchParams()` method on the wired-up `RouterAdapter` now returns a
  lazy snapshot from `defaultBrowserSearchParams()` (i.e.
  `window.location.search` on the client, empty `URLSearchParams` on
  the server). The `<Suspense>` wrapper is gone, so
  `<RouterAdapterProvider>` always mounts immediately and is present in
  every BPM view's ancestor chain throughout SSR and hydration.

- **Error thrown by `useRouterAdapter()` outside a provider pointed at a
  dead subpath.** The hint string referenced
  `<NextRouterAdapterProvider>` from
  `@rytass/bpm-core-react/pages/router-adapter` — neither the component
  nor the subpath has ever existed in the published package. Replaced
  with an accurate hint that names `<BPMNextProviders>` from
  `@rytass/bpm-core-react/next` (Next.js hosts) and
  `<RouterAdapterProvider>` (other hosts).

### Trade-off

- `RouterAdapter.searchParams()` is no longer reactive. Components that
  read it inside a render body will see the URL at first mount but will
  not re-render when the query string changes (without an accompanying
  pathname change). None of the shipped BPM views consume this method,
  so the change is API-compatible for the in-repo consumer. Hosts that
  want reactive query-string state should call Next's
  `useSearchParams()` directly in their page (wrapped in their own
  `<Suspense>` per Next 16 conventions), not via the BPM
  `RouterAdapter`.

### Why a patch

Bug fix only. Public API surface unchanged — same exports, same component
shape, same prop types.

## 0.4.0 — 2026-05-28

### Breaking

- **`<AppLayout>` removed from the public surface.** The 4-group
  Mezzanine `<Layout>` + `<Navigation>` shell BPM used to ship is no
  longer part of `@rytass/bpm-core-react`. Hosts are expected to own
  their navigation chrome and mount BPM views inside their existing
  sidebar / top bar. Together with `AppLayout`, the following exports
  are gone: `AppLayout`, `AppLayoutProps`, `AppNavigationGroup`.
- **Views no longer self-wrap.** Every view (`InboxView`, `FormsView`,
  `TemplatesView`, `AdminOrgsView`, … 13 in total) used to render
  `<AppLayout activeHref=…>…</AppLayout>` internally. They now return
  the page content fragment (a `<PageHeader>` + `<SectionGroup>`
  composition) so a host layout can wrap them. The `activeHref?` prop
  on `TemplatesView` / `DelegationsView` / `TemplateDesignerView` /
  `TemplateVersionsView` / `TemplateCategoriesView` / `AdminOrgsView` /
  `AdminUsersView` / `AdminDelegationsView` /
  `SettingsNotificationsView` is removed because it had no consumer
  after the layout was lifted out.
- **`DashboardPage` props simplified to `{}`** — `activeHref` removed
  for the same reason. The component still renders the five-metric
  workflow dashboard fragment unchanged.
- **`ApprovalInstanceListPage` no longer accepts `activeHref`.** The
  thin delegators (`SentView`, `CcView`, `SearchView`) drop the
  hard-coded `activeHref` argument accordingly.

### Added

- **`<BPMNotificationBellButton />`** — drop-in notification bell for
  host navigations. Opens the BPM `<NotificationDrawer />` (mounted by
  `<Providers>`) on click and renders an unread-count badge from
  `<NotificationUnreadProvider>`. Visual chrome uses Mezzanine
  `NavigationIconButton`, but the button is decoupled from the
  Mezzanine `<Navigation>` container — drop it anywhere in your nav.
  Hosts that want a fully custom trigger can skip this widget and
  consume `useNotificationDrawer().open` + `useNotificationUnread().unreadCount`
  directly.
- **`useBPMMember()` hook** — host-facing alias of `useAuth().member`.
  Returns the currently authenticated `ApiMember | null` without
  exposing the broader `useAuth()` surface.
- **`useBPMLogout()` hook** — host-facing alias of `useAuth().logout`.
  Returns `() => Promise<void>` that calls `logoutApi()` and redirects
  to the configured `loginPath`. Mount on host logout buttons / menu
  items so the host nav does not need to import `useAuth()` directly.

### Removed

- `AppLayout`, `AppLayoutProps`, `AppNavigationGroup` (see Breaking).
- `components/app-navigation.tsx` and `components/app-navigation.module.scss`
  are deleted from the lib source tree.

### Why a minor (0.x semver)

The library is still in `0.x` so breaking changes ride a minor bump per
the project's release convention. The change targets a single consumer
in the monorepo (`apps/client`) plus any external consumer wiring
`@rytass/bpm-core-react` into their own host — both are expected to
follow the migration recipe below.

### Migration

If your host re-exported page shims (`pages/<feature>`), you only need
to add a layout wrapper:

```diff
  // app/layout.tsx
  import { BPMNextProviders } from '@rytass/bpm-core-react/next';
+ import { MyHostLayout } from './_components/host-layout';

  export default function RootLayout({ children }) {
    return (
      <html lang="zh-TW"><body>
-       <BPMNextProviders>{children}</BPMNextProviders>
+       <BPMNextProviders>
+         <MyHostLayout>{children}</MyHostLayout>
+       </BPMNextProviders>
      </body></html>
    );
  }
```

For a reference `MyHostLayout` that reproduces the legacy 4-group BPM
nav using `useBPMRoutes` + `useBPMMember` + `useBPMLogout` +
`<BPMNotificationBellButton />`, copy
`apps/client/src/app/_components/host-layout.tsx` from the BPMCore
repo. Adjust groups, branding, and which routes you expose to match
your host.

If your host imported `AppLayout` directly, swap to the same host
layout pattern — `AppLayout` is no longer exported.

### Documentation

- README's `Usage` section rewritten around the new integration shape
  (host owns the layout; BPM provides widgets).
- New `docs/integration-guide.md` with a step-by-step host integration
  walkthrough, the recommended 4-group nav structure (`我的工作` /
  `查詢與代理` / `簽核設計` / `系統管理`), and notes on consuming the
  widgets / hooks.
- `docs/api-reference.md` updated to reflect the new root-barrel
  surface (`useBPMMember`, `useBPMLogout`, `BPMNotificationBellButton`)
  and the removal of `AppLayout` / `AppLayoutProps` /
  `AppNavigationGroup`.

## 0.3.8 — 2026-05-28

### Fixed

- **`React.ReactElement` return-type annotation** in
  `BPMRoutesProvider` and `RouterAdapterProvider` referenced the
  unimported `React` namespace. Compiled fine under typical `jsx:
  'react-jsx'` configs (which globalize the namespace) but broke
  under stricter consumer setups. Now uses the directly-imported
  `ReactElement` type to match the rest of the file.

### Changed

- **Dashboard "未讀通知" metric tile** now navigates to `routes.inbox()`
  instead of `routes.notifications()`. The previous target had no
  matching `pages/notifications` shim, so the click 404'd on hosts
  that hadn't built their own page at that path. Inbox is the
  most-actionable next step for an unread-notification click; the
  notification drawer bell stays available globally for in-place
  review.

### Documentation

- **`BPMRoutes.notifications()` JSDoc clarified** as a host-extension
  point: BPM's built-in views do not navigate to it by default. The
  default factory still returns `'/notifications'` so consumers can
  mount their own page at that path if desired; no BPM-shipped
  `pages/notifications` shim exists.

### Why a patch

Bug fix + behavior preservation. No public API change.

## 0.3.7 — 2026-05-28

### Documentation

- **`transpilePackages` list expanded** to include `@rytass/bpm-core-client`
  and `@rytass/bpm-core-shared` alongside `@rytass/bpm-core-react`. With
  pnpm strict mode + Turbopack, transitive peer-dep resolution into
  `node_modules/.pnpm/...` requires every package in the chain to be
  listed explicitly — previous versions only mentioned `@rytass/bpm-core-react`.
- **README "Status" banner refreshed** to `0.3.7` with a note pointing
  at the per-release CHANGELOG history.

### Why a patch

Documentation only.

## 0.3.6 — 2026-05-28

No source change. Lockstep peerDependency bump to `^0.1.9`.

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
