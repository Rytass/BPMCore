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

interface BPMNextProvidersProps {
  readonly children: ReactNode;
}

function BPMNextProvidersBody({
  children,
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
      <BPMProviders>{children}</BPMProviders>
    </RouterAdapterProvider>
  );
}

export function BPMNextProviders({
  children,
}: BPMNextProvidersProps): ReactElement {
  return (
    <Suspense fallback={null}>
      <BPMNextProvidersBody>{children}</BPMNextProvidersBody>
    </Suspense>
  );
}
