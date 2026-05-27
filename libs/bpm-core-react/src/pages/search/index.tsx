import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SearchView } from '../../views/search';

/**
 * Next.js metadata for the BPM case search page. Consumers re-export this
 * alongside the default page component.
 */
export const metadata: Metadata = {
  title: '案件查詢 | BPM Admin',
};

/**
 * Drop-in Next.js App Router page for the BPM case search. Usage in
 * `app/search/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/search';
 * ```
 */
export default function SearchPage(): ReactElement {
  return <SearchView />;
}
