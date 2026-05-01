import type { Metadata } from 'next';
import './global.scss';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'BPM Admin',
  description: 'Internal BPM approval engine administration console',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="zh-TW">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
