import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DelegationsView } from '../../views/delegations';

export const metadata: Metadata = {
  title: '我的代理 | BPM Admin',
  description: '設定自己的簽核代理，讓指定期間內的新待簽任務自動交由代理人處理。',
};

export default function DelegationsPage(): ReactElement {
  return <DelegationsView />;
}
