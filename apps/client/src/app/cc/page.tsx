'use client';

import type { ReactElement } from 'react';
import { ApprovalInstanceListPage } from '../_components/approval-instance-list-page';

export default function CcPage(): ReactElement {
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
