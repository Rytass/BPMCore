import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { LoginView } from '../../views/login';

/**
 * Next.js metadata for the BPM login page. Consumers re-export this
 * alongside the default page component.
 */
export const metadata: Metadata = {
  title: 'Login | BPM Admin',
  description: 'Sign in to the BPM approval workflow administration console.',
};

/**
 * Drop-in Next.js App Router page for the BPM login screen.
 *
 * Consumer usage in `app/login/page.tsx`:
 *
 * ```ts
 * export { default, metadata } from '@rytass/bpm-core-react/pages/login';
 * ```
 */
export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly next?: string }>;
}): Promise<ReactElement> {
  const { next } = await searchParams;
  return <LoginView defaultNextPath={next} />;
}
