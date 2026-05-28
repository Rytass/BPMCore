'use client';

import type { ReactElement } from 'react';
import { DashboardPage } from '../../components/dashboard-page';


/**
 * Framework-agnostic view for the BPM dashboard. Delegates to the shared
 * `<DashboardPage>` component. Mechanical port of
 * `apps/client/src/app/dashboard/page.tsx`.
 */
export function DashboardView(): ReactElement {
  return <DashboardPage />;
}
