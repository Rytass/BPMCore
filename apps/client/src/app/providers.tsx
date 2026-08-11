'use client';

import type { ReactElement, ReactNode } from 'react';
import { pdfjs } from 'react-pdf';
import { BPMNextProviders } from '@rytass/bpm-core-react/next';
import { HostShell } from './_components/host-shell';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

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
