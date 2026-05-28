# BPMCore Host Integration Guide

How to embed `@rytass/bpm-core-react` into a host application that owns
its own navigation chrome.

> Audience: teams adopting BPMCore inside an existing admin console
> (Shuttle, internal back-office, etc.) where there is already a
> sidebar, top bar, brand header, or design system that BPM views need
> to live inside.

---

## TL;DR

1. Mount `<BPMNextProviders>` once in your root layout (or in a layout
   that scopes BPM to a sub-tree).
2. Inside the providers, render your own host layout / sidebar.
3. Mount BPM views by re-exporting `@rytass/bpm-core-react/pages/<feature>`
   into your Next.js `app/<route>/page.tsx`.
4. Wire BPM behaviour into your nav with the host-facing widgets:
   - `<BPMNotificationBellButton />` — notification bell + unread badge
   - `useBPMMember()` — current member (avatar, display name)
   - `useBPMLogout()` — logout button handler
   - `useBPMRoutes()` — BPM internal path mapping (so your nav links
     point at the right BPM URLs)
   - `useRouterAdapter()` — current pathname for active-link styling

BPMCore does **not** ship a layout. There is no `<AppLayout>` in the
public surface as of 0.4.0.

---

## Step 1 — Wrap the tree with providers

`<BPMNextProviders>` composes everything BPM views need: Mezzanine
calendar locale, `<AuthProvider>` (current member + redirect-to-login
behaviour), `<NotificationUnreadProvider>` (polled unread count),
`<NotificationDrawerProvider>` (drawer open/close state), and mounts
`<NotificationDrawer />` as a global overlay.

```tsx
// app/layout.tsx
import { BPMNextProviders } from '@rytass/bpm-core-react/next';
import { HostLayout } from './_components/host-layout';

export default function RootLayout({ children }) {
  return (
    <html lang="zh-TW">
      <body>
        <BPMNextProviders loginPath="/login">
          <HostLayout>{children}</HostLayout>
        </BPMNextProviders>
      </body>
    </html>
  );
}
```

If your host already runs auth somewhere upstream (e.g. SSO) and BPM is
just a sub-tree, mount `<BPMNextProviders>` in the layout for that
sub-tree instead of the root.

---

## Step 2 — Build the host layout

The host layout is where you compose your sidebar, top bar, and BPM
widgets. There is no required shape — BPM only cares that:

- the auth flow can redirect to `loginPath` when unauthenticated
- the notification drawer overlay has somewhere to mount (handled by
  `<BPMNextProviders>` already)

Below is the recommended starting point. It reproduces the 4-group nav
BPM used to ship internally — feel free to remap, omit, or add groups.

### Recommended 4-group nav structure

| Group | Items | Notes |
|---|---|---|
| 我的工作 | 工作台 (`routes.dashboard`) · 我的待簽 (`routes.inbox`) · 我發起的 (`routes.sent`) · 抄送給我 (`routes.cc`) | Per-member workflow |
| 查詢與代理 | 搜尋 (`routes.search`) · 個人代理 (`routes.delegations`) | Cross-instance + personal delegation |
| 簽核設計 | 簽核模板 (`routes.templates`) · 模板分類 (`routes.templateCategories`) · 表單設計 (`routes.forms`) | Admin-only |
| 系統管理 | 組織管理 (`routes.adminOrgs`) · 會員對照 (`routes.adminUsers`) · 代理設定 (`routes.adminDelegations`) | Admin-only |

### Reference implementation

The BPMCore monorepo ships a runnable reference at
`apps/client/src/app/_components/host-layout.tsx`. It composes
Mezzanine `<Layout>` + `<Navigation>` and uses every BPM host-facing
widget:

```tsx
'use client';
import {
  Layout,
  Navigation,
  NavigationFooter,
  NavigationHeader,
  NavigationIconButton,
  NavigationOption,
  NavigationOptionCategory,
  NavigationUserMenu,
} from '@mezzanine-ui/react';
import { LogoutIcon, /* … */ } from '@mezzanine-ui/icons';
import {
  BPMNotificationBellButton,
  useBPMLogout,
  useBPMMember,
  useBPMRoutes,
  useRouterAdapter,
} from '@rytass/bpm-core-react';

export function HostLayout({ children }) {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const member = useBPMMember();
  const logout = useBPMLogout();
  // …compose nav groups, filter by isAdmin, render <Layout>…
  return (
    <Layout>
      <Navigation exactActivatedMatch>
        <NavigationHeader title="BPM Admin">…</NavigationHeader>
        {/* groups */}
        <NavigationFooter>
          <NavigationUserMenu options={[…]} onSelect={…}>
            {member?.name}
          </NavigationUserMenu>
          <BPMNotificationBellButton />
          <NavigationIconButton
            aria-label="登出"
            icon={LogoutIcon}
            onClick={() => void logout()}
            type="button"
          />
        </NavigationFooter>
      </Navigation>
      <Layout.Main>{children}</Layout.Main>
    </Layout>
  );
}
```

Copy that file, adapt branding, then prune nav groups you do not need.

### Hosts that do not use Mezzanine

The host layout does not have to use Mezzanine. The BPM widgets are
designed so a host with any other design system can still use the
behaviour:

- `<BPMNotificationBellButton />` renders a Mezzanine `NavigationIconButton`
  internally. If that styling clashes with your design system, skip
  the component and wire your own button:

  ```tsx
  import { useNotificationDrawer, useNotificationUnread } from '@rytass/bpm-core-react';

  function MyBell() {
    const { open } = useNotificationDrawer();
    const { unreadCount } = useNotificationUnread();
    return (
      <button onClick={open}>
        🔔 {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
      </button>
    );
  }
  ```

- `useBPMLogout()` and `useBPMMember()` are framework-agnostic hooks —
  they return functions / values, no rendering assumption.

---

## Step 3 — Mount BPM views

For each BPM feature you want to expose, re-export the matching page
shim from `@rytass/bpm-core-react/pages/<feature>`. The shims are
one-line Server Components that export `{ default, metadata }`:

```tsx
// app/inbox/page.tsx
export { default, metadata } from '@rytass/bpm-core-react/pages/inbox';

// app/templates/[id]/designer/page.tsx
export { default, metadata } from '@rytass/bpm-core-react/pages/templates/designer';
```

The full list of shims lives in `docs/api-reference.md` under
`@rytass/bpm-core-react` → `Pages (Next.js Server Component shims)`.

Hosts that want finer control over a single page (custom `metadata`,
extra wrapping, etc.) can skip the shim and import the `View` directly:

```tsx
// app/inbox/page.tsx
import { InboxView } from '@rytass/bpm-core-react/views/inbox';
export const metadata = { title: 'My Inbox' };
export default function MyInboxPage() {
  return <InboxView />;
}
```

---

## Step 4 — Mount BPM under a non-root URL prefix (optional)

If BPM lives under a sub-path (`/operations/approval/*`,
`/workspace/bpm/*`, etc.), wrap your tree in `<BPMRoutesProvider>` and
override every internal cross-link. See the same-titled section in
`libs/bpm-core-react/README.md` for the full recipe — the contract has
**19 entries** and `createDefaultBPMRoutes()` is the source of truth
for the route shape.

---

## What lives in the lib vs. the host (quick reference)

| Concern | Owned by lib | Owned by host |
|---|:-:|:-:|
| Auth context, session, redirect-to-login | ✅ | |
| Notification unread polling + drawer overlay | ✅ | |
| BPM internal route mapping | ✅ (overridable) | |
| BPM page bodies (Inbox, Forms, Templates, Admin, …) | ✅ | |
| Navigation shell / sidebar / top bar | | ✅ |
| Brand header, logo, layout grid | | ✅ |
| Member display, avatar, logout button placement | | ✅ |
| Notification bell placement | | ✅ (lib provides widget) |
| Active-link styling for host nav | | ✅ (lib provides `useRouterAdapter().pathname`) |

---

## See also

- `libs/bpm-core-react/README.md` — install + Next.js + pnpm transpile setup
- `libs/bpm-core-react/CHANGELOG.md` — 0.4.0 migration walkthrough
- `docs/api-reference.md` — every export in every published BPMCore package
- `apps/client/src/app/_components/host-layout.tsx` — runnable reference layout
