import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DashboardView } from '../../views/dashboard';

/**
 * Next.js metadata for the BPM dashboard page. Consumers re-export this
 * alongside the default page component.
 */
export const metadata: Metadata = {
  title: '工作台 | BPM Admin',
};

/**
 * Drop-in Next.js App Router page for the BPM dashboard. Usage in
 * `app/dashboard/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/dashboard';
 * ```
 */
export default function DashboardPage(): ReactElement {
  return <DashboardView />;
}
