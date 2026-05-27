# @rytass/bpm-core-react

React provider / hook / view components for the Rytass BPM approval workflow stack.

This package composes [`@mezzanine-ui/react`](https://www.npmjs.com/package/@mezzanine-ui/react) primitives with the BPM domain logic in [`@rytass/bpm-core-client`](https://www.npmjs.com/package/@rytass/bpm-core-client) and [`@rytass/bpm-core-shared`](https://www.npmjs.com/package/@rytass/bpm-core-shared) so a consumer can wire up the full BPM admin UI by re-exporting page modules from their Next.js App Router.

## Status

`0.2.0` — early POC release. Only the login chain is built out (`/views/login`, `/pages/login`, providers). The remaining 17 views (inbox, instances, templates, forms, admin, settings, delegations) are planned for subsequent 0.2.x point releases.

## Install

```bash
pnpm add @rytass/bpm-core-react @rytass/bpm-core-client @rytass/bpm-core-shared @mezzanine-ui/react @mezzanine-ui/icons
```

Peer requirements: React 18+, Mezzanine UI 1.1+. Next.js is required only when consuming the `pages/*` subpath; framework-agnostic consumers can use `views/*` directly with their own router adapter.

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

## License

MIT
