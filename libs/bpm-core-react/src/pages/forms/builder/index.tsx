import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { FormBuilderView } from '../../../views/forms/builder';

/**
 * Next.js metadata for the BPM form builder page. Consumers re-export this
 * alongside the default page component.
 */
export const metadata: Metadata = {
  title: '表單編輯器 | BPM Admin',
  description: '編輯 BPM 表單欄位、版本與預覽。',
};

/**
 * Drop-in Next.js App Router page for the BPM form builder screen.
 *
 * Consumer usage in `app/forms/[id]/builder/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/forms/builder';
 * ```
 */
export default async function FormBuilderPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <FormBuilderView formId={id} />;
}
