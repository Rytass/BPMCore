'use client';

import type { ReactElement } from 'react';
import { DashboardPage } from '../../components/dashboard-page';

export interface DashboardViewProps {}

/**
 * Framework-agnostic view for the BPM dashboard. Delegates to the shared
 * `<DashboardPage>` component. Mechanical port of
 * `apps/client/src/app/dashboard/page.tsx`.
 */
export function DashboardView(_props: DashboardViewProps = {}): ReactElement {
  return <DashboardPage activeHref="/dashboard" />;
}
