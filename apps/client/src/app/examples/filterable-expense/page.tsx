import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { FilterableExpenseExampleView } from './_components/filterable-expense-example-view';

/**
 * 欄位篩選示範頁，展示 host 如何用 SDK 的 `listApprovalInstancesPage`
 * 依表單欄位篩選案件（ADR 25）。此頁不屬於 BPM 業務頁，僅供整合參考。
 */
export const metadata: Metadata = {
  title: '欄位篩選示範 | BPM Admin',
};

export default function FilterableExpenseExamplePage(): ReactElement {
  return <FilterableExpenseExampleView />;
}
