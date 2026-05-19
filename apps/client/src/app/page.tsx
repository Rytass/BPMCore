'use client';

import type { ReactElement } from 'react';
import { DashboardPage } from './_components/dashboard-page';

export default function Page(): ReactElement {
  return <DashboardPage activeHref="/dashboard" />;
}
