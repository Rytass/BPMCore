'use client';

import type { ReactElement } from 'react';
import { ApprovalInstanceListPage } from '../../components/approval-instance-list-page';


/**
 * Framework-agnostic view for the BPM "sent" inbox — instances the current
 * member has initiated. Mechanical port of
 * `apps/client/src/app/sent/page.tsx`.
 */
export function SentView(): ReactElement {
  return (
    <ApprovalInstanceListPage
      defaultState={null}
      description="查看由你發起的簽核案件與目前流程狀態。"
      emptyMessage="目前沒有由你發起的簽核案件。"
      searchPlaceholder="關鍵字：搜尋案件、發起人、模板或狀態"
      title="我發起的"
      view="SENT"
    />
  );
}
