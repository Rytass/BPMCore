import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { AdminWebhookEndpointsView } from '../../../views/admin/webhook-endpoints';

export const metadata: Metadata = {
  title: 'Webhook 端點 | BPM Admin',
  description: '維護知會節點可呼叫的外部系統端點。',
};

export default function AdminWebhookEndpointsPage(): ReactElement {
  return <AdminWebhookEndpointsView />;
}
