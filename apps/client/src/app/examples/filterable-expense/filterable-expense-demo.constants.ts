/**
 * 欄位篩選示範的常數。
 *
 * 來源：apps/api/src/app/filterable-expense-demo.seed.ts 與
 * apps/api/src/app/api-form-data-source.ts。client 不 import apps/api，
 * 因此在此複製一份；seed 有變更時需同步更新。
 */

/** 請款申請（欄位篩選示範）模板，對應 seed 的 TEMPLATE id。 */
export const FILTERABLE_EXPENSE_TEMPLATE_ID =
  '50000000-0000-4000-8000-000000000014';

export interface DemoOption {
  readonly label: string;
  readonly value: string;
}

/** 對應 demo.vendors 資料來源，表單值為 vendor id（V-00N）。 */
export const VENDOR_OPTIONS: readonly DemoOption[] = [
  { label: '甲供應商', value: 'V-001' },
  { label: '乙精密工業', value: 'V-002' },
  { label: '丙包材行', value: 'V-003' },
  { label: '丁運輸', value: 'V-004' },
  { label: '戊化工材料', value: 'V-005' },
  { label: '己電子零件', value: 'V-006' },
];

export const COMPANY_OPTIONS: readonly DemoOption[] = [
  { label: '甲公司 C100', value: 'C100' },
  { label: '乙公司 C200', value: 'C200' },
];

export const REQUEST_TYPE_OPTIONS: readonly DemoOption[] = [
  { label: '貨品', value: 'GOODS' },
  { label: '勞務', value: 'SERVICE' },
  { label: '運費', value: 'FREIGHT' },
];

/** 需求部門的表單值是 org unit id，名稱取自 reset-demo-data 的組織資料。 */
export const DEPARTMENT_OPTIONS: readonly DemoOption[] = [
  { label: '財務管理部', value: '10000000-0000-4000-8000-000000000003' },
  { label: '人資行政部', value: '10000000-0000-4000-8000-000000000006' },
  { label: '資訊與製造系統部', value: '10000000-0000-4000-8000-000000000010' },
  { label: '製造生產部', value: '10000000-0000-4000-8000-000000000011' },
  { label: '業務管理部', value: '10000000-0000-4000-8000-000000000008' },
];
