'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Framework-agnostic router contract every BPM view consumes.
 *
 * Next.js App Router consumers wire it from `useRouter()` / `usePathname()`,
 * but the contract is intentionally generic so SPA / Remix / Tanstack Router
 * hosts can plug in the same `<RouterAdapterProvider>` with their own
 * navigation primitives.
 */
export interface RouterAdapter {
  /** Current pathname (e.g. "/inbox"). `null` during SSR before hydration. */
  readonly pathname: string | null;
  /** Navigate to `href` (push onto history). */
  push(href: string): void;
  /** Navigate to `href` and replace the current history entry. */
  replace(href: string): void;
  /** Optional: go back. Falls back to `history.back()` when omitted. */
  back?(): void;
  /**
   * Optional search params accessor. Returned `URLSearchParams` should be
   * read-only — mutating it does not navigate. Default implementation reads
   * `window.location.search` on the client.
   */
  searchParams?(): URLSearchParams;
}

const RouterAdapterContext = createContext<RouterAdapter | null>(null);

export interface RouterAdapterProviderProps {
  readonly value: RouterAdapter;
  readonly children: ReactNode;
}

/**
 * Wraps the BPM React tree so `useRouterAdapter()` resolves to the host's
 * navigation primitives. Consumers typically put this once at the very root
 * of their layout (or inside a `'use client'` shim that reads
 * `useRouter()` + `usePathname()` from `next/navigation`).
 */
export function RouterAdapterProvider({
  value,
  children,
}: RouterAdapterProviderProps): React.ReactElement {
  return (
    <RouterAdapterContext.Provider value={value}>
      {children}
    </RouterAdapterContext.Provider>
  );
}

/**
 * Reads the host-provided {@link RouterAdapter}. Throws when used outside a
 * `<RouterAdapterProvider>` to surface wiring mistakes early.
 */
export function useRouterAdapter(): RouterAdapter {
  const value = useContext(RouterAdapterContext);
  if (!value) {
    throw new Error(
      'useRouterAdapter must be used inside <RouterAdapterProvider>. ' +
        'In Next.js, wrap your app with <NextRouterAdapterProvider> from ' +
        '`@rytass/bpm-core-react/pages/router-adapter`.',
    );
  }
  return value;
}

/**
 * Pure default search-params reader for the browser. Server-side returns an
 * empty `URLSearchParams`. Used internally when a {@link RouterAdapter}
 * does not override `searchParams()`.
 */
export function defaultBrowserSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}
