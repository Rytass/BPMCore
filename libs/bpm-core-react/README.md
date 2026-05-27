# @rytass/bpm-core-react

React provider / hook / view components for the Rytass BPM approval workflow stack.

This package composes [`@mezzanine-ui/react`](https://www.npmjs.com/package/@mezzanine-ui/react) primitives with the BPM domain logic in [`@rytass/bpm-core-client`](https://www.npmjs.com/package/@rytass/bpm-core-client) and [`@rytass/bpm-core-shared`](https://www.npmjs.com/package/@rytass/bpm-core-shared) so a consumer can wire up the full BPM admin UI by re-exporting page modules from their Next.js App Router.

## Status

`0.3.7` — adds `BPMRoutesProvider` for host-controlled path remapping (0.3.2), forwards `loginPath` / `publicPaths` / `locale` on `BPMNextProviders` (0.3.3), 19 view subpaths + 19 Next.js page shims (`pages/<feature>`), `next` subpath barrel, and foundation root barrel. See `CHANGELOG.md` for the per-release history.

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

### Drop-in Next.js page

```tsx
// app/login/page.tsx
export { default, metadata } from '@rytass/bpm-core-react/pages/login';
```

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
    templateDesigner:   (id) => `${trim}/templates/${id}/designer`,
    templateVersions:   (id) => `${trim}/templates/${id}/versions`,
    templateCategories:    () => `${trim}/templates/categories`,
    forms:                 () => `${trim}/forms`,
    formBuilder:        (id) => `${trim}/forms/${id}/builder`,
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
