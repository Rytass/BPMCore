import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SentView } from '../../views/sent';

/**
 * Next.js metadata for the BPM "sent" page. Consumers re-export this
 * alongside the default page component.
 */
export const metadata: Metadata = {
  title: '我發起的 | BPM Admin',
};

/**
 * Drop-in Next.js App Router page for the BPM sent inbox. Usage in
 * `app/sent/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/sent';
 * ```
 */
export default function SentPage(): ReactElement {
  return <SentView />;
}
