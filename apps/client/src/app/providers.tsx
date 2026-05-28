'use client';

import type { ReactElement, ReactNode } from 'react';
import { BPMNextProviders } from '@rytass/bpm-core-react/next';
import { HostShell } from './_components/host-shell';

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps): ReactElement {
  return (
    <BPMNextProviders>
      <HostShell>{children}</HostShell>
    </BPMNextProviders>
  );
}
