'use client';

import type { ReactElement, ReactNode } from 'react';
import { BPMNextProviders } from '@rytass/bpm-core-react/next';

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps): ReactElement {
  return <BPMNextProviders>{children}</BPMNextProviders>;
}
