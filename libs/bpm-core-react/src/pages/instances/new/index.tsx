import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { InstanceNewView } from '../../../views/instances/new';

/**
 * Next.js metadata for the BPM "launch approval" page. Consumers re-export
 * this alongside the default page component.
 */
export const metadata: Metadata = {
  title: '發起簽核 | BPM Admin',
};

/**
 * Drop-in Next.js App Router page for the BPM launch screen. Usage in
 * `app/instances/new/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/instances/new';
 * ```
 */
export default async function InstanceNewPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly templateId?: string }>;
}): Promise<ReactElement> {
  const { templateId } = await searchParams;
  return <InstanceNewView templateId={templateId ?? null} />;
}
