'use client';

import { useEffect, type ReactElement, type ReactNode } from 'react';
import { BPMNextProviders } from '@rytass/bpm-core-react/next';
import { HostLanguageProvider } from './_components/host-language';
import { HostShell } from './_components/host-shell';

interface ProvidersProps {
  readonly children: ReactNode;
}

function PdfWorkerSetup(): null {
  useEffect((): void => {
    void import('react-pdf').then(({ pdfjs }): void => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
    });
  }, []);

  return null;
}

export function Providers({ children }: ProvidersProps): ReactElement {
  return (
    <HostLanguageProvider>
      {(language): ReactNode => (
        <BPMNextProviders language={language}>
          <PdfWorkerSetup />
          <HostShell>{children}</HostShell>
        </BPMNextProviders>
      )}
    </HostLanguageProvider>
  );
}
