import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { InboxView } from '../../views/inbox';

/**
 * Next.js metadata for the BPM inbox page. Consumers re-export this
 * alongside the default page component.
 */
export const metadata: Metadata = {
  title: '我的待簽 | BPM Admin',
};

/**
 * Drop-in Next.js App Router page for the BPM inbox. Usage in
 * `app/inbox/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/inbox';
 * ```
 */
export default function InboxPage(): ReactElement {
  return <InboxView />;
}
