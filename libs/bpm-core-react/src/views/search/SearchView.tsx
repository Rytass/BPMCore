'use client';

import type { ReactElement } from 'react';
import { ApprovalInstanceListPage } from '../../components/approval-instance-list-page';

export interface SearchViewProps {}

/**
 * Framework-agnostic view for the BPM case search page — list of all
 * instances the current member has visibility on. Mechanical port of
 * `apps/client/src/app/search/page.tsx`.
 */
export function SearchView(_props: SearchViewProps = {}): ReactElement {
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
