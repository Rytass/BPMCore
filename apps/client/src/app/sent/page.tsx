'use client';

import type { ReactElement } from 'react';
import { ApprovalInstanceListPage } from '../_components/approval-instance-list-page';

export default function SentPage(): ReactElement {
  return (
    <ApprovalInstanceListPage
      activeHref="/sent"
      defaultState={null}
      description="查看由你發起的簽核案件與目前流程狀態。"
      emptyMessage="目前沒有由你發起的簽核案件。"
      searchPlaceholder="關鍵字：搜尋案件、發起人、模板或狀態"
      title="我發起的"
      view="SENT"
    />
  );
}
