'use client';

// One-line Next.js App Router shim for BPM. Reads `next/navigation`
// router/pathname hooks, builds a `RouterAdapter`, then composes
// `<RouterAdapterProvider>` and the shared `<BPMProviders>`.
//
// IMPORTANT: This component intentionally does NOT call
// `useSearchParams()`. Doing so triggers Next.js's CSR bailout at static
// prerender, and any `<Suspense fallback={null}>` we wrap around it then
// erases `<RouterAdapterProvider>` from the SSR/hydration tree — leaving
// every BPM view to throw "must be used inside <RouterAdapterProvider>"
// when it mounts. None of the shipped BPM views consume
// `RouterAdapter.searchParams()` anyway; hosts that need reactive query
// string state should call Next's `useSearchParams()` directly in their
// page (with their own Suspense). The lazy default getter below is
// good enough for read-on-demand callers.

import { useMemo, type ReactElement, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Providers as BPMProviders,
  RouterAdapterProvider,
  defaultBrowserSearchParams,
  type RouterAdapter,
} from '@rytass/bpm-core-react';
import type { CalendarLocale } from '@mezzanine-ui/react/moment';

export interface BPMNextProvidersProps {
  readonly children: ReactNode;
  /**
   * Override the Mezzanine calendar locale. Forwarded to the inner
   * `<Providers>`. Defaults to `CalendarLocale.ZH_TW`.
   */
  readonly locale?: CalendarLocale;
  /**
   * Routes that must remain accessible without a BPM session — visiting
   * these does not redirect to `loginPath` even when `member` is null.
   * Forwarded to `<AuthProvider>`. Defaults to `['/login']`.
   *
   * Hosts that mount BPM under a non-root prefix (see
   * `<BPMRoutesProvider>`) should typically expand this to include their
   * own auth-bypass paths.
   */
  readonly publicPaths?: readonly string[];
  /**
   * Where to redirect unauthenticated users. Forwarded to
   * `<AuthProvider>`. Defaults to `'/login'`. Hosts owning their own
   * login route (the recommended case) override this to their host
   * route, e.g. `'/auth/sign-in'`.
   */
  readonly loginPath?: string;
}

/**
 * One-line Next.js App Router shim for the full BPM provider stack.
 * Mounts in the host's root layout (or layout for the BPM sub-tree):
 *
 * ```tsx
 * import { BPMNextProviders } from '@rytass/bpm-core-react/next';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html><body>
 *       <BPMNextProviders loginPath="/auth/sign-in">
 *         {children}
 *       </BPMNextProviders>
 *     </body></html>
 *   );
 * }
 * ```
 *
 * Forwards every prop on {@link BPMNextProvidersProps} to the inner
 * `<Providers>` and `<AuthProvider>`. For per-feature path remapping
 * (BPM internal navigation), additionally wrap with
 * `<BPMRoutesProvider>` exported from the same subpath.
 */
export function BPMNextProviders({
  children,
  locale,
  publicPaths,
  loginPath,
}: BPMNextProvidersProps): ReactElement {
  const nextRouter = useRouter();
  const pathname = usePathname();

  const adapter = useMemo<RouterAdapter>(
    () => ({
      pathname,
      push: (href: string): void => nextRouter.push(href),
      replace: (href: string): void => nextRouter.replace(href),
      back: (): void => nextRouter.back(),
      searchParams: (): URLSearchParams => defaultBrowserSearchParams(),
    }),
    [nextRouter, pathname],
  );

  return (
    <RouterAdapterProvider value={adapter}>
      <BPMProviders
        locale={locale}
        publicPaths={publicPaths}
        loginPath={loginPath}
      >
        {children}
      </BPMProviders>
    </RouterAdapterProvider>
  );
}
