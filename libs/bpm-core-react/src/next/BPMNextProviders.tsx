'use client';

// One-line Next.js App Router shim for BPM. Reads `next/navigation` hooks,
// builds a `RouterAdapter`, then composes `<RouterAdapterProvider>` and the
// shared `<BPMProviders>`. Wrapped in `<Suspense>` so static prerender of
// routes like `/404` does not fail on `useSearchParams()` during `next build`.

import { Suspense, useMemo, type ReactElement, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Providers as BPMProviders,
  RouterAdapterProvider,
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

function BPMNextProvidersBody({
  children,
  locale,
  publicPaths,
  loginPath,
}: BPMNextProvidersProps): ReactElement {
  const nextRouter = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const adapter = useMemo<RouterAdapter>(
    () => ({
      pathname,
      push: (href: string): void => nextRouter.push(href),
      replace: (href: string): void => nextRouter.replace(href),
      back: (): void => nextRouter.back(),
      searchParams: (): URLSearchParams =>
        new URLSearchParams(searchParams?.toString() ?? ''),
    }),
    [nextRouter, pathname, searchParams],
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
export function BPMNextProviders(props: BPMNextProvidersProps): ReactElement {
  return (
    <Suspense fallback={null}>
      <BPMNextProvidersBody {...props} />
    </Suspense>
  );
}
