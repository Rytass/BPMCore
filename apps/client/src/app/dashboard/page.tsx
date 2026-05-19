'use client';

import type { ReactElement } from 'react';
import { DashboardPage } from '../_components/dashboard-page';

export default function DashboardRoutePage(): ReactElement {
  return <DashboardPage activeHref="/dashboard" />;
}
