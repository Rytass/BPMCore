'use client';

import type { ReactElement } from 'react';
import { ApprovalInstanceListPage } from '../_components/approval-instance-list-page';

export default function SearchPage(): ReactElement {
  return (
    <ApprovalInstanceListPage
      activeHref="/search"
      defaultState={null}
      description="以關鍵字與狀態查詢你有權限查看的簽核案件。"
      emptyMessage="沒有符合條件的簽核案件。"
      searchPlaceholder="關鍵字：搜尋案件、發起人、模板或狀態"
      title="案件搜尋"
      view="ALL"
    />
  );
}
