'use client';

import type { ReactElement } from 'react';


/**
 * Framework-agnostic placeholder for the BPM root path. Server-side redirect
 * to `/dashboard` is the consumer's responsibility (Next.js `middleware.ts`
 * or `app/page.tsx`). This view renders nothing so it can be safely mounted
 * during the redirect flash.
 *
 * Mechanical port of `apps/client/src/app/page.tsx`.
 */
export function RootView(): ReactElement | null {
  return null;
}
