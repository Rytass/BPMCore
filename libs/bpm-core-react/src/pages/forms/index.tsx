import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { FormsView } from '../../views/forms';

/**
 * Next.js metadata for the BPM forms list page. Consumers re-export this
 * alongside the default page component.
 */
export const metadata: Metadata = {
  title: '表單管理 | BPM Admin',
  description: '建立、編輯與管理 BPM 表單定義版本。',
};

/**
 * Drop-in Next.js App Router page for the BPM forms list screen.
 *
 * Consumer usage in `app/forms/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/forms';
 * ```
 */
export default function FormsPage(): ReactElement {
  return <FormsView />;
}
