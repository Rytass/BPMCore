import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { InstanceDetailView } from '../../../views/instances/detail';

/**
 * Next.js metadata for the BPM instance detail page. Consumers re-export
 * this alongside the default page component.
 */
export const metadata: Metadata = {
  title: '案件詳情 | BPM Admin',
};

/**
 * Drop-in Next.js App Router page for the BPM instance detail screen.
 * Accepts the standard App Router `params: Promise<{ id: string }>` shape
 * and forwards the resolved `id` into the view as `instanceId`.
 *
 * Usage in `app/instances/[id]/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/instances/detail';
 * ```
 */
export default async function InstanceDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <InstanceDetailView instanceId={id} />;
}
