'use client';

import type { ReactElement } from 'react';
import { ApprovalInstanceListPage } from '../../components/approval-instance-list-page';

export interface CcViewProps {}

/**
 * Framework-agnostic view for the BPM "cc" inbox — instances the current
 * member is copied on. Mechanical port of
 * `apps/client/src/app/cc/page.tsx`.
 */
export function CcView(_props: CcViewProps = {}): ReactElement {
  return (
    <ApprovalInstanceListPage
      activeHref="/cc"
      defaultState={null}
      description="查看抄送給你的簽核案件。"
      emptyMessage="目前沒有抄送給你的簽核案件。"
      searchPlaceholder="關鍵字：搜尋案件、發起人、模板或狀態"
      title="抄送給我"
      view="CC"
    />
  );
}
