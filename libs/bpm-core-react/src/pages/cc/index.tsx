import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { CcView } from '../../views/cc';

/**
 * Next.js metadata for the BPM "cc" page. Consumers re-export this
 * alongside the default page component.
 */
export const metadata: Metadata = {
  title: '抄送給我 | BPM Admin',
};

/**
 * Drop-in Next.js App Router page for the BPM cc inbox. Usage in
 * `app/cc/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/cc';
 * ```
 */
export default function CcPage(): ReactElement {
  return <CcView />;
}
