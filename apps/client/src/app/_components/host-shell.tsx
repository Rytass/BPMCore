'use client';

import type { ReactElement, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { HostLayout } from './host-layout';

/**
 * Paths that should render bare (no sidebar chrome) — login screen and
 * the root redirect target.
 */
const BARE_PATHS: ReadonlySet<string> = new Set(['/', '/login']);

export interface HostShellProps {
  readonly children?: ReactNode;
}

/**
 * Decides whether the current route should be wrapped in {@link HostLayout}
 * (BPM admin chrome) or rendered bare (login / root redirect). Keeps the
 * pathname check on the client so the root `<RootLayout>` stays a Server
 * Component with stable metadata.
 */
export function HostShell({ children }: HostShellProps): ReactElement {
  const pathname = usePathname();
  if (pathname && BARE_PATHS.has(pathname)) {
    return <>{children}</>;
  }
  return <HostLayout>{children}</HostLayout>;
}
