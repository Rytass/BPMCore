# @rytass/bpm-core-react

React provider / hook / view components for the Rytass BPM approval workflow stack.

This package composes [`@mezzanine-ui/react`](https://www.npmjs.com/package/@mezzanine-ui/react) primitives with the BPM domain logic in [`@rytass/bpm-core-client`](https://www.npmjs.com/package/@rytass/bpm-core-client) and [`@rytass/bpm-core-shared`](https://www.npmjs.com/package/@rytass/bpm-core-shared) so a consumer can wire up the full BPM admin UI by re-exporting page modules from their Next.js App Router.

Form views understand the additive `autocomplete` and option-source schema
variants while preserving primitive single-value and multiple-value payloads.
Dynamic registry queries and server-side validation remain behind the BPM
client/core runtime boundaries; React controls do not call external sources
directly. Pass a `dataSourceContext` with `kind: 'preview'` for designer
preview or a published-template/instance `kind: 'runtime'` context for an
editable form. Read-only instance rendering should omit the runtime context
and pass `optionSnapshots` so historical labels remain available without a
network query.

## Status

`0.4.0` (breaking) — drops the bundled navigation shell. BPM views no longer wrap themselves in an `<AppLayout>` / Mezzanine `<Navigation>`; the host owns the layout chrome and mounts BPM views inside its own sidebar / top bar. New host-facing widgets ship in the root barrel: `useBPMMember`, `useBPMLogout`, `<BPMNotificationBellButton />`. See `CHANGELOG.md` for the migration walkthrough, and `docs/integration-guide.md` for a host integration recipe.

## Install

```bash
pnpm add @rytass/bpm-core-react @rytass/bpm-core-client @rytass/bpm-core-shared @mezzanine-ui/react @mezzanine-ui/icons
```

Peer requirements: React 18+, Mezzanine UI 1.1+. Next.js is required only when consuming the `pages/*` subpath; framework-agnostic consumers can use `views/*` directly with their own router adapter.

### Next.js + pnpm setup

If your host uses Next.js (15+) with pnpm strict mode, add the package to `transpilePackages` in `next.config.js`. Without this, Next's Turbopack cannot resolve transitive peer-dep imports such as `@rytass/bpm-core-client/workflow` from inside pnpm-isolated `node_modules/.pnpm/...` paths.

```js
/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Include the sibling packages too — BPM views import from
  // `@rytass/bpm-core-client/workflow`, `/organization`, `/template`,
  // `/form` and re-export shared types from `@rytass/bpm-core-shared`.
  // pnpm strict mode + Turbopack rejects the transitive resolution
  // without each entry listed explicitly.
  transpilePackages: [
    '@rytass/bpm-core-react',
    '@rytass/bpm-core-client',
    '@rytass/bpm-core-shared',
  ],
};
```

## Usage

### Host integration shape

BPM ships **page bodies, providers, and widgets** — never a full layout.
The host wires its own `<Layout>` / `<Navigation>` (or its own design
system equivalent), then drops BPM widgets and views into the slots:

```tsx
// app/layout.tsx
import { BPMNextProviders } from '@rytass/bpm-core-react/next';
import { MyHostLayout } from './host-layout';

export default function RootLayout({ children }) {
  return (
    <html lang="zh-TW"><body>
      <BPMNextProviders>
        <MyHostLayout>{children}</MyHostLayout>
      </BPMNextProviders>
    </body></html>
  );
}
```

```tsx
// app/host-layout.tsx
'use client';
import {
  BPMNotificationBellButton,
  useBPMLogout,
  useBPMMember,
  useBPMRoutes,
  useRouterAdapter,
} from '@rytass/bpm-core-react';

export function MyHostLayout({ children }) {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const member = useBPMMember();
  const logout = useBPMLogout();
  return (
    <div className="grid grid-cols-[240px_1fr]">
      <aside>
        <h1>My Console</h1>
        <ul>
          <li><a href={routes.dashboard()}>工作台</a></li>
          <li><a href={routes.inbox()}>我的待簽</a></li>
          {/* …host's own nav items… */}
        </ul>
        <div className="flex items-center gap-2">
          <span>{member?.name}</span>
          <BPMNotificationBellButton />
          <button onClick={() => logout()}>登出</button>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
```

The page shims under `pages/*` are unchanged — they remain one-line
`{ default, metadata }` re-exports and are mounted under the host
layout exactly like any other Next.js page:

```tsx
// app/inbox/page.tsx
export { default, metadata } from '@rytass/bpm-core-react/pages/inbox';
```

For an end-to-end reference layout (with the original 4-group BPM nav
structure, admin-only filtering, and member display), see
`apps/client/src/app/_components/host-layout.tsx` in the BPMCore repo.

### Framework-agnostic view

```tsx
'use client';
import { useRouter, usePathname } from 'next/navigation';
import {
  AuthProvider,
  RouterAdapterProvider,
} from '@rytass/bpm-core-react';
import { LoginView } from '@rytass/bpm-core-react/views/login';

function MyLoginPage() {
  const next = useRouter();
  const pathname = usePathname();
  return (
    <RouterAdapterProvider value={{ pathname, push: next.push, replace: next.replace }}>
      <AuthProvider>
        <LoginView brandTitle="My BPM" />
      </AuthProvider>
    </RouterAdapterProvider>
  );
}
```

For SPA / Remix / Tanstack Router hosts, supply a `RouterAdapter` that bridges your router primitives.

### Ad-hoc directives on the instance detail page

The instance detail view ships UI for the four instance-scoped ad-hoc
directives (they never modify the workflow template). When the signed-in
member is the current task's approver, the page header shows:

- **會簽** / **加簽** — ad-hoc countersign (joins the next stage in
  parallel) and pre-approval (blocks the current stage until the added
  signer approves, with a rejection-behavior choice). Both buttons only
  appear when the template node sets `allowAddSigner: true`.
- **通知設定** — stage-end and instance-completion notifications to
  members or a webhook URL.

Ad-hoc tasks appear in the tasks table tagged 「（臨時會簽）」/「（臨時加簽）」,
and still-pending directives are listed under 「待生效的臨時設定」 where the
creator can withdraw them. No extra wiring is required — the feature works
wherever `InstanceDetailView` (or the `pages/instances/detail` shim) is
mounted, provided the backend module is up to date. The standalone
`InstanceTasksSection` component requires the `adhocDirectives` prop
(fetch with `listAdhocDirectives` from `@rytass/bpm-core-client/workflow`).

### Mounting BPM under a non-root URL prefix

If your host already owns the `/` namespace (Shuttle, an existing
admin console, etc.), wrap the BPM tree in `<BPMRoutesProvider>` and
override every internal cross-link to a prefixed path. The full
`BPMRoutes` contract has **19 entries** — overriding only some leaves
the rest pointing at the unprefixed defaults, which usually 404s on
your host. Use a small factory to keep the override exhaustive:

```tsx
import {
  BPMRoutesProvider,
  createDefaultBPMRoutes,
  type BPMRoutes,
} from '@rytass/bpm-core-react/next';

function createPrefixedRoutes(prefix: string): BPMRoutes {
  const trim = prefix.replace(/\/$/, '');
  return {
    ...createDefaultBPMRoutes(), // safety net for any future routes
    dashboard:             () => `${trim}`,
    inbox:                 () => `${trim}/inbox`,
    sent:                  () => `${trim}/sent`,
    cc:                    () => `${trim}/cc`,
    search:                () => `${trim}/search`,
    delegations:           () => `${trim}/delegations`,
    notifications:         () => `${trim}/notifications`,
    caseDetail:    (id)         => `${trim}/instances/${id}`,
    caseNew:       (templateId) => templateId
      ? `${trim}/instances/new?templateId=${encodeURIComponent(templateId)}`
      : `${trim}/instances/new`,
    templates:             () => `${trim}/templates`,
    templateCompose:       () => `${trim}/templates/compose`,
    templateDesigner:   (id) => `${trim}/templates/${id}/designer`,
    templateVersions:   (id) => `${trim}/templates/${id}/versions`,
    templateCategories:    () => `${trim}/templates/categories`,
    notificationSettings:  () => `${trim}/settings/notifications`,
    adminOrgs:             () => `${trim}/admin/orgs`,
    adminUsers:            () => `${trim}/admin/users`,
    adminDelegations:      () => `${trim}/admin/delegations`,
  };
}

// In your layout:
<BPMRoutesProvider value={createPrefixedRoutes('/operations/approval')}>
  <BPMNextProviders>{children}</BPMNextProviders>
</BPMRoutesProvider>
```

`createDefaultBPMRoutes()` is the source of truth for the route shape;
spreading it first means new BPMCore versions that add routes never
silently regress your host.

## License

MIT
