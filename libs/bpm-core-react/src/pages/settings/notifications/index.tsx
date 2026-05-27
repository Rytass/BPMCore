import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SettingsNotificationsView } from '../../../views/settings/notifications';

export const metadata: Metadata = {
  title: '通知設定 | BPM Admin',
  description: '調整站內通知、Email 通知與摘要頻率。',
};

export default function SettingsNotificationsPage(): ReactElement {
  return <SettingsNotificationsView />;
}
