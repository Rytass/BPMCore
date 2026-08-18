## 0.9.1 (2026-08-18)

### 🩹 Fixes

- **bpm-core-react:** keep moment a required dependency ([41dd5fa](https://github.com/Rytass/BPMCore/commit/41dd5fa))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.9.0 (2026-08-17)

### 🚀 Features

- **notification:** lift routing fields onto the created event ([e02270b](https://github.com/Rytass/BPMCore/commit/e02270b))
- **notification:** let a host observe notifications as they are created ([#21](https://github.com/Rytass/BPMCore/pull/21))
- **shared:** detect a quorum no approver set can ever satisfy ([5671497](https://github.com/Rytass/BPMCore/commit/5671497))
- **shared:** expose the decision policy to the workflow toolset ([f6152b0](https://github.com/Rytass/BPMCore/commit/f6152b0))
- **bpm-core-react:** let the designer configure the decision policy ([6a4caf1](https://github.com/Rytass/BPMCore/commit/6a4caf1))

### 🩹 Fixes

- ⚠️  **template:** reject deleting a referenced category ([#16](https://github.com/Rytass/BPMCore/pull/16))
- **template:** let a template actually change category ([#17](https://github.com/Rytass/BPMCore/pull/17))
- **shared:** keep an approver change from discarding a workable policy ([ea6afbe](https://github.com/Rytass/BPMCore/commit/ea6afbe))
- **bpm-core-react:** stop the member resolve effect looping on failure ([a0bfa66](https://github.com/Rytass/BPMCore/commit/a0bfa66))
- **bpm-core-react:** stop the dropped-policy notice outliving its subject ([7fddefe](https://github.com/Rytass/BPMCore/commit/7fddefe))
- **bpm-core-react:** re-request members left as unresolved placeholders ([567c776](https://github.com/Rytass/BPMCore/commit/567c776))
- **bpm-core-react:** finish the member picker's stale-response handling ([dda3692](https://github.com/Rytass/BPMCore/commit/dda3692))
- **bpm-core-react:** keep the dropped-policy notice on screen ([7557dc8](https://github.com/Rytass/BPMCore/commit/7557dc8))
- **bpm-core-react:** stop re-applying an unsatisfiable policy ([e548f14](https://github.com/Rytass/BPMCore/commit/e548f14))
- **bpm-core-react:** tolerate malformed stored quorum policies ([f4fcb41](https://github.com/Rytass/BPMCore/commit/f4fcb41))
- **bpm-core-react:** cap PERCENTAGE quorum threshold and sanitise every write ([d70528a](https://github.com/Rytass/BPMCore/commit/d70528a))
- **bpm-core-react:** stop member pickers offering stale or phantom rows ([f4f82c9](https://github.com/Rytass/BPMCore/commit/f4f82c9))
- **e2e:** poll on the expected value in the quorum threshold sanitiser spec ([099529f](https://github.com/Rytass/BPMCore/commit/099529f))
- **bpm-core-react:** correct decision-policy panel review findings ([ebf0337](https://github.com/Rytass/BPMCore/commit/ebf0337))
- **bpm-core-react:** show only the latest member search results ([9804d37](https://github.com/Rytass/BPMCore/commit/9804d37))

### ⚠️  Breaking Changes

- **template:** reject deleting a referenced category  ([#16](https://github.com/Rytass/BPMCore/pull/16))
  `deleteApprovalTemplateCategory` now throws
  `BadRequestException` when templates still reference the category, instead
  of deactivating it and reporting success.
  The old behaviour substituted a different operation for the one requested
  and returned the same entity type either way, so a caller could not tell
  that the delete had not happened — nor that `isActive` had been flipped as
  a side effect it never asked for. Downstream, the category vanished from
  groupings because it was now inactive, with nothing to explain why.
  Deactivation is not lost: `deactivateApprovalTemplateCategory(id)` has
  always existed and is unchanged, so the fallback was never the only way to
  reach that state.
  The designer's category screen already wraps the call in try/catch and
  surfaces the message, and it only closes the confirmation dialog on
  success, so the new error reaches the author without a UI change.
  Reported by a consumer on 0.7.0, who had to re-implement the reference
  check ahead of the call to avoid telling users something had been deleted
  when it had not.
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5
- Claude Opus 5 (1M context)
- Kai-Chieh Yang

# Changelog

All notable changes to `@rytass/bpm-core-react` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Form builder and renderer schemas now recognize the `autocomplete` option
  field while retaining Mezzanine controls and primitive form values.
- FormRenderer now supports host-bounded preview/runtime DataSource contexts,
  snapshot hydration, async Mezzanine Select/AutoComplete controls, complete
  list Radio/Checkbox controls, paging/search state, retry feedback, and
  submission blocking for unresolved dynamic values.
- FormBuilderView now loads the host DataSource Catalog, filters sources by
  control capability, edits field/constant bindings, preserves bindings when a
  field key changes, and confirms source/mode changes or dependent-field
  removal before updating the schema. DataSource schema lint is available from
  the editor.

### Fixed

- The template designer now restores missing legacy edge data before rendering,
  so older workflow JSON without an edge `data` object remains editable.
- Dynamic option failures no longer surface raw `FORM_DATA_SOURCE_*` codes.
  Launch, resubmit, field-level, form builder lint, and template
  designer/compose publish messages now show mapped copy, so a value that
  expired reads as "已選取的選項已失效，請重新選擇。" instead of an error code.
- A stale dynamic field now asks the host to resolve its selected values instead
  of trusting the merged option list, which still carries the instance snapshot
  and would vouch for a value the source has already dropped. A value the host
  cannot resolve turns the field `INVALID`, is marked individually, and blocks
  resubmit.
- A control bound to an optional DataSource parameter is no longer disabled
  forever when that dependency field is empty. `WAITING_FOR_DEPENDENCIES` now
  follows the server's `waitingForFieldKeys`; the browser's optimistic guess
  survives only until the first response, and AutoComplete makes no guess at all
  because nothing could correct it while the control is disabled.
- A read-only dynamic field with no value is quiet instead of reporting
  "選項來源暫時無法使用。" next to a retry button that could not do anything.
  `FormDataSourceFieldState` gained `canRetry`, and the renderer only offers
  retry when a query can actually be re-issued.
- A recoverable search failure such as `FORM_DATA_SOURCE_SEARCH_TOO_SHORT` now
  shows an inline hint and leaves the field as usable as it was, instead of
  marking the source unavailable and blocking a submission that was valid.
- `InstanceFormSection` now passes only `instanceId` when a returned instance is
  reopened for editing. It previously sent `templateId` as well, which the
  runtime context rejects (exactly one is required), so every dynamic option
  query during return-edit failed with "沒有權限查詢此欄位的選項。". The existing
  e2e coverage missed it because it only asserted snapshot labels, which need no
  query.

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.8.0 — 2026-08-10

### Added

- **SLA and return-comment controls in the template designer.** The node panel
  had no SLA fields at all, so a working-day deadline could only be set through
  the API. It now exposes the timer the way the approver resolver already
  works — a master toggle that progressively reveals the duration, its unit,
  the calendar mode, the timeout action, the escalation level and the warning
  threshold — plus a `returnBehavior.requireComment` toggle.

  The deadline is entered as a number and a unit rather than a raw ISO
  duration, so the form cannot produce a mixed `P1DT4H`; the calendar selector
  only appears for day-based durations, since a business calendar advances
  whole days only.

- **Required return comments in the instance view.** The return dialog marks
  the comment required and keeps the submit button disabled until it is filled,
  so approvers see the node's rule before the server rejects the decision.

### Fixed

- **Designer toggles were not label-clickable.** `FormField` renders
  `<label htmlFor={name}>`, but the toggles carried no matching `id`, so those
  labels pointed at nothing. All node-panel toggles now set `id` and `name`.

### Changed

- Widened peer dependency ranges to `^0.4.0 || ^0.5.0 || ^0.6.0 || ^0.7.0` for
  `@rytass/bpm-core-client` and `@rytass/bpm-core-shared`. The new designer
  controls read `SlaConfig.calendar` and `ReturnBehavior.requireComment`, which
  only exist from 0.7.0 — on older core packages the extra fields are simply
  absent and the panel falls back to its previous behaviour.

### Why a minor

New optional UI controls over additive contract fields; no component API or
existing behaviour changed.

## 0.7.7 — 2026-08-04

### Changed

- Widened peer dependency ranges to `^0.4.0 || ^0.5.0 || ^0.6.0` for
  `@rytass/bpm-core-client` and `@rytass/bpm-core-shared` so downstream apps can
  install the 0.6.x core packages (date picker timezone fix, manager resolution
  priority + depth filtering) without a peer conflict. No component or source
  changes.

## 0.7.6 — 2026-07-06

### Changed

- Widened peer dependency ranges to `^0.4.0 || ^0.5.0` for
  `@rytass/bpm-core-client` and `@rytass/bpm-core-shared` so downstream apps can
  install the 0.5.x core packages (member directory paged search) without a peer
  conflict. No component or source changes.

## 0.7.5 — 2026-07-03

### Changed

- The organization tree now opens fully expanded — collapsing is a per-user
  action, never a default. The depth / layer-width initial-collapse heuristics
  from 0.7.3 are removed, and a 全部展開 / 全部收合 shortcut panel (top-right
  of the canvas) folds the tree down to the root plus top-level org units or
  restores it in one click.

### Fixed

- Tree node cards no longer sit on the next rank's connection lines. The card
  scss is `min-height` and the action buttons wrap to a second row, so real
  card heights exceed the size declared to dagre; the layout now re-runs with
  the rendered dimensions ReactFlow reports (and no longer pins the node
  wrapper to an inline height, which had clamped those measurements), plus the
  rank separation is raised from dagre's default 50 to 96 so a readable edge
  corridor survives even before the measured relayout lands.

## 0.7.4 — 2026-07-03

### Fixed

- The `@xyflow/react` base stylesheet is now bundled into the package css.
  xyflow v12 does no runtime style injection, so any host that did not import
  `@xyflow/react/dist/style.css` itself rendered every ReactFlow surface
  (organization tree, workflow designer, instance detail) as an unpositioned
  document-flow stack — nodes piled up and clipped, Controls flattened into a
  horizontal strip. The stylesheet now ships as `dist/style.css`, imported
  automatically by the orgs / designer / instance-detail chunks, so consumers
  need zero configuration. Hosts that already import the xyflow stylesheet are
  unaffected (the rules are identical and loading them twice is harmless).

## 0.7.3 — 2026-07-02

### Fixed

- The organization tree editor's readable opening viewport now actually shows
  the tree: dagre can place the synthetic root at the far edge of an asymmetric
  layout, so anchoring on the root's own coordinates opened onto empty margin
  with every other node off-screen. The root is now re-centered over the layout
  width and the opening viewport anchors on the layout's horizontal center and
  top ranks.
- The 收合 / 展開 (and 編輯 / 新增) buttons on tree node cards now respond to
  real mouse clicks. The node action row was only marked `nodrag`, so a click
  with ≥1px of pointer jitter was captured by the canvas pan gesture and the
  click was suppressed before reaching the button; the row is now also `nopan`.
- The initial expansion of a large organization tree now also stops before any
  level that would render more than 12 sibling nodes side by side — depth alone
  still let a wide level open thousands of pixels across.
- Collapsing or expanding a subtree re-centers the viewport on the toggled node
  (at the user's current zoom), so the layout shift from the re-run dagre
  layout no longer leaves the change off-screen.

## 0.7.2 — 2026-07-02

### Fixed

- The organization tree editor now stays readable and interactive for large,
  very wide trees. Instead of `fitView` shrinking a ~19:1 tree to an unreadable
  line (which also made manual Zoom In feel stuck), large trees open at a
  readable zoom anchored on the root node while small trees still fit to view.

### Added

- Collapsible subtrees in the organization tree editor: every node with
  children shows a 收合 / 展開 toggle, and large trees start expanded to only
  the first few levels so they open readable and the user drills down. The
  MiniMap stays hidden for large trees.

## 0.7.1 — 2026-07-02

### Fixed

- Large organization trees now fit inside the tree editor: `minZoom` is derived
  from the dagre layout bounds instead of a fixed `0.25`, so `fitView` can
  shrink very wide/deep trees enough to reveal the whole graph rather than
  clipping it off-screen. The MiniMap is hidden above 80 nodes, where it
  degrades into an unreadable black block.

### Changed

- Peer dependencies now require `@rytass/bpm-core-client` ^0.4.0 and
  `@rytass/bpm-core-shared` ^0.4.0.

## 0.7.0 — 2026-06-10

### Added

- Workflow AI assistant surfaced in the template compose wizard.

## 0.6.0 — 2026-06-06

### Added

- Ad-hoc directive UI on the instance detail page: 會簽 / 加簽 buttons
  (shown when the node sets `allowAddSigner`), a 通知設定 button for
  stage-end and completion notifications (member or webhook targets), task
  rows tagged 「（臨時會簽）」/「（臨時加簽）」, and a 「待生效的臨時設定」
  table where the creator can withdraw pending directives.

### Changed

- **`InstanceTasksSection` requires the new `adhocDirectives` prop.** Hosts
  rendering the section standalone must fetch it with
  `listAdhocDirectives` from `@rytass/bpm-core-client/workflow`;
  `InstanceDetailView` wires it automatically.
- Peer dependencies now require `@rytass/bpm-core-client` ^0.3.0 and
  `@rytass/bpm-core-shared` ^0.3.0.

### Fixed

- Header action buttons keep stable identities across re-renders, so
  approve / reject clicks are no longer lost while instance data loads.

## 0.5.0 — 2026-06-04

Covers all changes since 0.4.1, including the undocumented internal
0.4.2–0.4.4 version bumps.

### Breaking

- **The standalone forms area is removed.** Forms are now designed only
  inside the template compose wizard and the designer's form drawer.
  Removed surfaces:
  - `FormsView` and the `./views/forms` subpath (the
    `./views/forms/builder` and `./views/forms/renderer` subpaths
    remain).
  - The `./pages/forms` and `./pages/forms/builder` Next.js page shims
    (`/forms`, `/forms/[id]/builder`). Hosts must delete the
    corresponding `app/forms/**` re-export files.
  - `BPMRoutes.forms()` and `BPMRoutes.formBuilder(formId)` — hosts
    providing a custom `BPMRoutes` map must drop these members.
- **`FormBuilderView` is now a pure controlled panel.** The `formId`
  and `embedded` props are removed; the component no longer loads from
  or saves to the server. Use `value` / `onChange` only — server
  persistence happens through the compose wizard or
  `composeApprovalTemplateWithForm`.
- **`TemplateNameModal` is removed.** Template creation goes through
  the compose wizard; the name-and-category modal flow no longer
  exists. `TemplateCategoryOption` now lives in `TemplatesView`.

### Added

- **Template compose wizard** (`./views/templates/compose`,
  `./pages/templates/compose`, route `/templates/compose`):
  `TemplateComposeWizardView` designs a form and an approval flow
  together — the form step embeds the builder, the review step can
  dry-run the flow — and publishes both atomically.
- **Designer upgrades** (`TemplateDesignerView`): embedded mode for
  wizard reuse, an in-page form edit drawer, a dry-run button
  (`showDryRun` prop / `BPM_TEMPLATE_DRY_RUN_ENABLED` env on the page
  shim), and one-click save-and-publish — the publish button forks and
  saves the draft as needed instead of requiring a separate save-draft
  step first.
- **Instance detail sections.** `InstanceDetailView` is split into
  individually exported `InstanceFormSection` /
  `InstanceAttachmentsSection` / `InstanceTasksSection` /
  `InstanceSignaturesSection` / `InstanceHistorySection`, toggleable
  via `showForm` / `showAttachments` / `showTasks` / `showSignatures` /
  `showHistory` props.
- **Notification drawer resolution states.** Resolved task
  notifications render their outcome instead of offering stale
  approve / reject actions.

### Changed

- `TemplatesView`: the create entry routes to the compose wizard (one
  primary 建立模板 button); the modal-based create flow is removed.

### Why a minor

Removes the standalone forms surfaces and `FormBuilderView`'s
server-backed mode — breaking under 0.x SemVer conventions
(0.4.x → 0.5.0).

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
