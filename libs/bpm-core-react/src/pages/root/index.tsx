import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';

/**
 * Next.js metadata for the BPM root path.
 */
export const metadata: Metadata = {
  title: 'BPM Admin',
};

/**
 * Drop-in Next.js App Router page for the BPM root path. Server-side
 * redirects to `/dashboard` — never renders any client tree, so it cannot
 * pollute the chunk boundary with `'use client'`.
 *
 * Consumer usage in `app/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/root';
 * ```
 */
export default function RootPage(): ReactElement {
  redirect('/dashboard');
}
