import { createHash } from 'crypto';
import type {
  FormDataSourceValueSnapshot,
  FormDefinitionSchema,
  FormFieldValue,
  FormUiSchema,
} from '@rytass/bpm-core-shared';
import {
  DEMO_VENDOR_OPTIONS,
  VENDOR_DATA_SOURCE_KEY,
} from './api-form-data-source';

/**
 * Pure data for the filterable expense template (請款範本) used by the ADR 25
 * acceptance scenario (`docs/26-instance-field-filter-phases.md`, §驗收情境).
 *
 * Lives outside `tools/reset-demo-data.ts` because that script runs `main()` on
 * import, and the jest spec next to this file has to load the data without a
 * database. `reset-demo-data.ts` turns these records into table rows with its
 * own helpers.
 *
 * ## Fixed ids (for verifiers)
 *
 * | 物件 | id |
 * | --- | --- |
 * | 表單定義 | `30000000-0000-4000-8000-000000000010` |
 * | 表單版本 v1 | `31000000-0000-4000-8000-000000000012` |
 * | 範本 | `50000000-0000-4000-8000-000000000014` |
 * | 範本版本 v1 | `51000000-0000-4000-8000-000000000016` |
 * | 實例 | `60000000-0000-4000-8000-000000000101` … `…000000000124`（24 筆，見下方 `FILTERABLE_EXPENSE_RECIPES`） |
 *
 * Non-filterable `note` and `items.memo` are deliberate: they show that an
 * undeclared field cannot be used as a filter.
 */
export const FILTERABLE_EXPENSE_IDS = {
  FORM_DEFINITION: '30000000-0000-4000-8000-000000000010',
  FORM_VERSION: '31000000-0000-4000-8000-000000000012',
  TEMPLATE: '50000000-0000-4000-8000-000000000014',
  TEMPLATE_VERSION: '51000000-0000-4000-8000-000000000016',
} as const;

export const FILTERABLE_EXPENSE_CATEGORY_ID =
  '40000000-0000-4000-8000-000000000001';

export const FILTERABLE_EXPENSE_TEMPLATE_NAME = '請款申請（欄位篩選示範）';

export const FILTERABLE_EXPENSE_TEMPLATE_DESCRIPTION =
  'ADR 25 示範範本：廠商、金額、申請日、公司別、請款類型、需求部門與品項明細皆可依欄位篩選與排序。';

/** Same values as `ORG_UNIT_IDS` in `tools/reset-demo-data.ts`; the spec checks it. */
export const FILTERABLE_EXPENSE_ORG_UNIT_IDS = {
  FINANCE: '10000000-0000-4000-8000-000000000003',
  HR: '10000000-0000-4000-8000-000000000006',
  IT: '10000000-0000-4000-8000-000000000010',
  PRODUCT: '10000000-0000-4000-8000-000000000011',
  SALES: '10000000-0000-4000-8000-000000000008',
} as const;

export const FILTERABLE_EXPENSE_FORM_SCHEMA = {
  fields: [
    {
      dataSource: {
        bindings: [],
        key: VENDOR_DATA_SOURCE_KEY,
        version: 1,
      },
      fieldKey: 'vendor',
      filterable: true,
      label: '廠商',
      required: true,
      type: 'autocomplete',
    },
    {
      fieldKey: 'amountTwd',
      filterable: true,
      hidden: true,
      label: '金額（TWD）',
      required: false,
      type: 'money',
    },
    {
      fieldKey: 'applyDate',
      filterable: true,
      label: '申請日',
      required: false,
      type: 'date',
    },
    {
      fieldKey: 'companyCode',
      filterable: true,
      label: '公司別',
      options: [
        { label: '甲公司 C100', value: 'C100' },
        { label: '乙公司 C200', value: 'C200' },
      ],
      required: true,
      type: 'select',
    },
    {
      fieldKey: 'requestType',
      filterable: true,
      label: '請款類型',
      options: [
        { label: '貨品', value: 'GOODS' },
        { label: '勞務', value: 'SERVICE' },
        { label: '運費', value: 'FREIGHT' },
      ],
      required: true,
      type: 'select',
    },
    {
      fieldKey: 'demandDept',
      filterable: true,
      label: '需求部門',
      required: true,
      type: 'org_unit',
    },
    {
      addRowLabel: '新增品項',
      columns: [
        {
          fieldKey: 'sku',
          filterable: true,
          label: '品號',
          required: true,
          type: 'text',
        },
        {
          fieldKey: 'qty',
          filterable: true,
          label: '數量',
          required: true,
          type: 'number',
        },
        {
          fieldKey: 'memo',
          label: '備註',
          required: false,
          type: 'text',
        },
      ],
      fieldKey: 'items',
      label: '請款品項',
      maxRows: 10,
      minRows: 1,
      required: true,
      type: 'table',
    },
    {
      fieldKey: 'note',
      label: '內部備註',
      required: false,
      type: 'text',
    },
  ],
  schemaVersion: 1,
} as const satisfies FormDefinitionSchema;

export const FILTERABLE_EXPENSE_FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'vendor', width: 'HALF' },
    { fieldKey: 'applyDate', width: 'HALF' },
    { fieldKey: 'companyCode', width: 'HALF' },
    { fieldKey: 'requestType', width: 'HALF' },
    { fieldKey: 'demandDept', width: 'HALF' },
    { fieldKey: 'amountTwd', width: 'HALF' },
    { fieldKey: 'items', width: 'FULL' },
    { fieldKey: 'note', width: 'FULL' },
  ],
  schemaVersion: 1,
} as const satisfies FormUiSchema;

/**
 * Two approval nodes. Every case passes the first; only cases that got past it
 * reach the second, so the finance reviewer has tasks on several cases.
 */
export const FILTERABLE_EXPENSE_APPROVAL_NODES = [
  {
    id: 'dept_review',
    label: '部門主管簽核',
    resolver: { memberIds: ['member-501'], type: 'DIRECT' },
    x: 220,
    y: 0,
  },
  {
    id: 'finance_review',
    label: '財務覆核',
    resolver: { memberIds: ['member-101'], type: 'DIRECT' },
    x: 460,
    y: 0,
  },
] as const;

export const FILTERABLE_EXPENSE_NOTIFICATION_BODY =
  '您被抄送此請款案件，僅供知悉。';

type InstanceState =
  | 'APPROVED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'RETURNED'
  | 'RUNNING';

type RunningAt = 'dept_review' | 'finance_review';

type CompanyCode = 'C100' | 'C200';
type RequestType = 'FREIGHT' | 'GOODS' | 'SERVICE';
type DeptKey = keyof typeof FILTERABLE_EXPENSE_ORG_UNIT_IDS;

/**
 * One row of the seed. `amountTwd: undefined` leaves the key out of the form
 * data, which is the "欄位不存在" case; `null` is the "值為空" case.
 */
interface FilterableExpenseRecipe {
  readonly id: string;
  readonly n: number;
  readonly initiatorMemberId: string;
  readonly vendorId: string;
  readonly amountTwd?: number | null;
  readonly applyDate: string | null;
  readonly companyCode: CompanyCode;
  readonly requestType: RequestType;
  readonly dept: DeptKey;
  readonly items: readonly (readonly [string, number, string])[];
  readonly note: string;
  readonly state: InstanceState;
  readonly runningAt?: RunningAt;
  /** Calendar day `YYYY-MM-DD`; submission time is derived from it. */
  readonly startDate: string;
  readonly updateDate: string;
  readonly completedDate: string | null;
  readonly ccMemberIds: readonly string[];
}

/**
 * 24 cases. Coverage the verifier relies on:
 * - four initiators (member-102, 202, 302, 502); member-101 signs every finance task
 * - member-402 appears nowhere, so it sees no case in ALL/SENT/CC views
 * - CC notifications on cases 1, 4, 7, 10, 13, 16, 19, 22
 * - states: 6 RUNNING (3 at dept, 3 at finance), 11 APPROVED, 3 RETURNED, 2 REJECTED, 2 CANCELLED
 * - case 17 has no amount key; case 21 has `applyDate: null`
 * - SKU-A with qty >= 10: case 5 and case 12 have it on the same row, so they
 *   match; case 4, case 10 and case 16 have SKU-A and qty >= 10 on different
 *   rows (counterexamples); case 12 uses the boundary value 10
 * - amounts range from 3,200 to 1,250,000; vendor V-001 spans 7,400 to 88,800
 */
export const FILTERABLE_EXPENSE_RECIPES: readonly FilterableExpenseRecipe[] = [
  {
    id: '60000000-0000-4000-8000-000000000101',
    n: 1,
    initiatorMemberId: 'member-102',
    vendorId: 'V-001',
    amountTwd: 48000,
    applyDate: '2026-02-02',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'PRODUCT',
    items: [
      ['SKU-A', 3, '螺絲'],
      ['SKU-B', 8, '墊圈'],
    ],
    note: '二月例行採購',
    state: 'RUNNING',
    runningAt: 'dept_review',
    startDate: '2026-02-03',
    updateDate: '2026-02-03',
    completedDate: null,
    ccMemberIds: ['member-103'],
  },
  {
    id: '60000000-0000-4000-8000-000000000102',
    n: 2,
    initiatorMemberId: 'member-202',
    vendorId: 'V-002',
    amountTwd: 125000,
    applyDate: '2026-02-10',
    companyCode: 'C200',
    requestType: 'SERVICE',
    dept: 'HR',
    items: [['SKU-C', 1, '教育訓練場地']],
    note: '講師費',
    state: 'RUNNING',
    runningAt: 'finance_review',
    startDate: '2026-02-11',
    updateDate: '2026-02-16',
    completedDate: null,
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000103',
    n: 3,
    initiatorMemberId: 'member-302',
    vendorId: 'V-003',
    amountTwd: 8600,
    applyDate: '2026-02-18',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'SALES',
    items: [['SKU-D', 40, '包裝箱']],
    note: '展會包材',
    state: 'RUNNING',
    runningAt: 'dept_review',
    startDate: '2026-02-19',
    updateDate: '2026-02-19',
    completedDate: null,
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000104',
    n: 4,
    initiatorMemberId: 'member-502',
    vendorId: 'V-001',
    amountTwd: 15300,
    applyDate: '2026-02-25',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'PRODUCT',
    items: [
      ['SKU-A', 3, '螺絲'],
      ['SKU-B', 25, '墊圈'],
    ],
    note: 'SKU-A 與數量 ≥ 10 不同列',
    state: 'APPROVED',
    startDate: '2026-02-26',
    updateDate: '2026-03-02',
    completedDate: '2026-03-02',
    ccMemberIds: ['member-001'],
  },
  {
    id: '60000000-0000-4000-8000-000000000105',
    n: 5,
    initiatorMemberId: 'member-102',
    vendorId: 'V-005',
    amountTwd: 62000,
    applyDate: '2026-03-03',
    companyCode: 'C200',
    requestType: 'GOODS',
    dept: 'PRODUCT',
    items: [['SKU-A', 15, '同列命中']],
    note: '化學原料',
    state: 'APPROVED',
    startDate: '2026-03-04',
    updateDate: '2026-03-09',
    completedDate: '2026-03-09',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000106',
    n: 6,
    initiatorMemberId: 'member-202',
    vendorId: 'V-004',
    amountTwd: 3200,
    applyDate: '2026-03-06',
    companyCode: 'C100',
    requestType: 'FREIGHT',
    dept: 'HR',
    items: [['SKU-E', 1, '車資']],
    note: '員工訓練車資',
    state: 'APPROVED',
    startDate: '2026-03-06',
    updateDate: '2026-03-07',
    completedDate: '2026-03-07',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000107',
    n: 7,
    initiatorMemberId: 'member-302',
    vendorId: 'V-006',
    amountTwd: 98000,
    applyDate: '2026-03-10',
    companyCode: 'C200',
    requestType: 'GOODS',
    dept: 'SALES',
    items: [['SKU-F', 20, '感測器']],
    note: '樣品零件',
    state: 'RETURNED',
    startDate: '2026-03-11',
    updateDate: '2026-03-13',
    completedDate: '2026-03-13',
    ccMemberIds: ['member-103', 'member-001'],
  },
  {
    id: '60000000-0000-4000-8000-000000000108',
    n: 8,
    initiatorMemberId: 'member-502',
    vendorId: 'V-003',
    amountTwd: 22100,
    applyDate: '2026-03-12',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'PRODUCT',
    items: [['SKU-D', 120, '包裝箱']],
    note: '包材補貨',
    state: 'REJECTED',
    startDate: '2026-03-13',
    updateDate: '2026-03-16',
    completedDate: '2026-03-16',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000109',
    n: 9,
    initiatorMemberId: 'member-102',
    vendorId: 'V-002',
    amountTwd: 310000,
    applyDate: '2026-03-17',
    companyCode: 'C200',
    requestType: 'SERVICE',
    dept: 'FINANCE',
    items: [['SKU-C', 1, '設備保養']],
    note: '年度保養（已取消）',
    state: 'CANCELLED',
    startDate: '2026-03-18',
    updateDate: '2026-03-20',
    completedDate: '2026-03-20',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000110',
    n: 10,
    initiatorMemberId: 'member-202',
    vendorId: 'V-001',
    amountTwd: 7400,
    applyDate: '2026-03-22',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'HR',
    items: [
      ['SKU-A', 4, '螺絲'],
      ['SKU-C', 50, '標籤'],
    ],
    note: 'SKU-A 與數量 ≥ 10 不同列',
    state: 'APPROVED',
    startDate: '2026-03-23',
    updateDate: '2026-03-25',
    completedDate: '2026-03-25',
    ccMemberIds: ['member-103'],
  },
  {
    id: '60000000-0000-4000-8000-000000000111',
    n: 11,
    initiatorMemberId: 'member-302',
    vendorId: 'V-005',
    amountTwd: 56500,
    applyDate: '2026-03-26',
    companyCode: 'C200',
    requestType: 'GOODS',
    dept: 'SALES',
    items: [['SKU-B', 12, '墊圈']],
    note: '展示用耗材',
    state: 'RUNNING',
    runningAt: 'finance_review',
    startDate: '2026-03-27',
    updateDate: '2026-04-01',
    completedDate: null,
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000112',
    n: 12,
    initiatorMemberId: 'member-502',
    vendorId: 'V-006',
    amountTwd: 132000,
    applyDate: '2026-04-02',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'PRODUCT',
    items: [
      ['SKU-A', 10, '邊界值 10'],
      ['SKU-G', 2, '治具'],
    ],
    note: 'SKU-A 與數量 = 10 同列',
    state: 'APPROVED',
    startDate: '2026-04-03',
    updateDate: '2026-04-08',
    completedDate: '2026-04-08',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000113',
    n: 13,
    initiatorMemberId: 'member-102',
    vendorId: 'V-004',
    amountTwd: 4100,
    applyDate: '2026-04-06',
    companyCode: 'C200',
    requestType: 'FREIGHT',
    dept: 'FINANCE',
    items: [['SKU-E', 2, '運費']],
    note: '運費',
    state: 'RETURNED',
    startDate: '2026-04-07',
    updateDate: '2026-04-09',
    completedDate: '2026-04-09',
    ccMemberIds: ['member-001'],
  },
  {
    id: '60000000-0000-4000-8000-000000000114',
    n: 14,
    initiatorMemberId: 'member-202',
    vendorId: 'V-003',
    amountTwd: 27800,
    applyDate: '2026-04-10',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'HR',
    items: [['SKU-D', 60, '紙箱']],
    note: '福利品包裝',
    state: 'APPROVED',
    startDate: '2026-04-11',
    updateDate: '2026-04-15',
    completedDate: '2026-04-15',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000115',
    n: 15,
    initiatorMemberId: 'member-302',
    vendorId: 'V-002',
    amountTwd: 185000,
    applyDate: '2026-04-14',
    companyCode: 'C200',
    requestType: 'SERVICE',
    dept: 'SALES',
    items: [['SKU-C', 1, '顧問服務']],
    note: '市場顧問',
    state: 'REJECTED',
    startDate: '2026-04-15',
    updateDate: '2026-04-18',
    completedDate: '2026-04-18',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000116',
    n: 16,
    initiatorMemberId: 'member-502',
    vendorId: 'V-001',
    amountTwd: 61000,
    applyDate: '2026-04-20',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'PRODUCT',
    items: [
      ['SKU-B', 30, '墊圈'],
      ['SKU-A', 2, '螺絲'],
    ],
    note: '墊圈補貨',
    state: 'APPROVED',
    startDate: '2026-04-21',
    updateDate: '2026-04-24',
    completedDate: '2026-04-24',
    ccMemberIds: ['member-103'],
  },
  {
    id: '60000000-0000-4000-8000-000000000117',
    n: 17,
    initiatorMemberId: 'member-102',
    vendorId: 'V-005',
    // Key left out on purpose: the "欄位不存在" case.
    applyDate: '2026-04-22',
    companyCode: 'C200',
    requestType: 'GOODS',
    dept: 'PRODUCT',
    items: [['SKU-F', 5, '感測器']],
    note: '金額待補（欄位不存在）',
    state: 'RUNNING',
    runningAt: 'dept_review',
    startDate: '2026-04-23',
    updateDate: '2026-04-23',
    completedDate: null,
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000118',
    n: 18,
    initiatorMemberId: 'member-202',
    vendorId: 'V-004',
    amountTwd: 9800,
    applyDate: '2026-04-27',
    companyCode: 'C100',
    requestType: 'FREIGHT',
    dept: 'HR',
    items: [['SKU-E', 1, '運費']],
    note: '物流',
    state: 'APPROVED',
    startDate: '2026-04-28',
    updateDate: '2026-04-29',
    completedDate: '2026-04-29',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000119',
    n: 19,
    initiatorMemberId: 'member-302',
    vendorId: 'V-006',
    amountTwd: 46000,
    applyDate: '2026-05-01',
    companyCode: 'C200',
    requestType: 'GOODS',
    dept: 'SALES',
    items: [['SKU-H', 10, '電源模組']],
    note: '樣品（已取消）',
    state: 'CANCELLED',
    startDate: '2026-05-02',
    updateDate: '2026-05-03',
    completedDate: '2026-05-03',
    ccMemberIds: ['member-001'],
  },
  {
    id: '60000000-0000-4000-8000-000000000120',
    n: 20,
    initiatorMemberId: 'member-502',
    vendorId: 'V-002',
    amountTwd: 275000,
    applyDate: '2026-05-04',
    companyCode: 'C100',
    requestType: 'SERVICE',
    dept: 'PRODUCT',
    items: [['SKU-C', 1, '製程改善顧問']],
    note: '製程改善',
    state: 'APPROVED',
    startDate: '2026-05-05',
    updateDate: '2026-05-09',
    completedDate: '2026-05-09',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000121',
    n: 21,
    initiatorMemberId: 'member-102',
    vendorId: 'V-003',
    amountTwd: 14500,
    // Empty application date: the "applyDate 為空" case.
    applyDate: null,
    companyCode: 'C200',
    requestType: 'GOODS',
    dept: 'FINANCE',
    items: [
      ['SKU-D', 20, '紙箱'],
      ['SKU-B', 2, '膠帶'],
    ],
    note: '申請日未填',
    state: 'RETURNED',
    startDate: '2026-05-06',
    updateDate: '2026-05-07',
    completedDate: '2026-05-07',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000122',
    n: 22,
    initiatorMemberId: 'member-202',
    vendorId: 'V-001',
    amountTwd: 88800,
    applyDate: '2026-05-07',
    companyCode: 'C200',
    requestType: 'GOODS',
    dept: 'HR',
    items: [['SKU-B', 12, '墊圈']],
    note: '辦公耗材',
    state: 'APPROVED',
    startDate: '2026-05-08',
    updateDate: '2026-05-11',
    completedDate: '2026-05-11',
    ccMemberIds: ['member-001'],
  },
  {
    id: '60000000-0000-4000-8000-000000000123',
    n: 23,
    initiatorMemberId: 'member-502',
    vendorId: 'V-005',
    amountTwd: 1250000,
    applyDate: '2026-05-09',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'PRODUCT',
    items: [['SKU-G', 1, '設備']],
    note: '產線設備（大額）',
    state: 'APPROVED',
    startDate: '2026-05-10',
    updateDate: '2026-05-12',
    completedDate: '2026-05-12',
    ccMemberIds: [],
  },
  {
    id: '60000000-0000-4000-8000-000000000124',
    n: 24,
    initiatorMemberId: 'member-302',
    vendorId: 'V-006',
    amountTwd: 3350,
    applyDate: '2026-05-08',
    companyCode: 'C100',
    requestType: 'GOODS',
    dept: 'IT',
    items: [
      ['SKU-F', 2, '感測器'],
      ['SKU-A', 1, '螺絲'],
    ],
    note: '資訊設備耗材',
    state: 'RUNNING',
    runningAt: 'finance_review',
    startDate: '2026-05-09',
    updateDate: '2026-05-10',
    completedDate: null,
    ccMemberIds: [],
  },
];

/** The member who never initiates, signs or is copied on any case. */
export const FILTERABLE_EXPENSE_UNRELATED_MEMBER_ID = 'member-402';

export const FILTERABLE_EXPENSE_DEPT_MANAGER_MEMBER_ID = 'member-501';
export const FILTERABLE_EXPENSE_FINANCE_REVIEWER_MEMBER_ID = 'member-101';

export interface FilterableExpenseTaskSeed {
  readonly id: string;
  readonly nodeId: string;
  readonly assigneeMemberId: string;
  readonly status: 'CANCELLED' | 'COMPLETED' | 'IN_PROGRESS';
  readonly slaDueAt: string;
  readonly createdAt: string;
  readonly openedAt: string | null;
  readonly completedAt: string | null;
}

export interface FilterableExpenseTokenSeed {
  readonly id: string;
  readonly currentNodeId: string;
  readonly status: 'ACTIVE' | 'CONSUMED';
  readonly createdAt: string;
  readonly consumedAt: string | null;
}

export interface FilterableExpenseNotificationSeed {
  readonly id: string;
  readonly recipientMemberId: string;
  readonly instanceId: string;
  readonly title: string;
  readonly sentAt: string;
}

/** A fully resolved seed case: everything `reset-demo-data.ts` needs for one instance. */
export interface FilterableExpenseInstanceSeed {
  readonly id: string;
  readonly initiatorMemberId: string;
  readonly title: string;
  readonly state: InstanceState;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly formData: Readonly<Record<string, FormFieldValue>>;
  readonly optionSnapshot: Readonly<Record<string, FormDataSourceValueSnapshot>>;
  readonly token: FilterableExpenseTokenSeed;
  readonly tasks: readonly FilterableExpenseTaskSeed[];
  readonly ccMemberIds: readonly string[];
}

const DEPT_NODE_ID = 'dept_review';
const FINANCE_NODE_ID = 'finance_review';

/**
 * Builds the resolved case list. The values here are the canonical storage
 * shape (ADR 25 §6): money as a JSON number, dates as `YYYY-MM-DD`, datetimes as
 * `Date#toISOString()`, so the seed never bypasses a write check it would fail.
 */
export function readFilterableExpenseInstances(): readonly FilterableExpenseInstanceSeed[] {
  return FILTERABLE_EXPENSE_RECIPES.map(createInstanceSeed);
}

export function readFilterableExpenseNotifications(): readonly FilterableExpenseNotificationSeed[] {
  return readFilterableExpenseInstances().flatMap((instance) =>
    instance.ccMemberIds.map((memberId, index) => ({
      id: `70000000-0000-4000-8000-${String(
        6000 + readRecipeNumber(instance.id) * 10 + index,
      ).padStart(12, '0')}`,
      instanceId: instance.id,
      recipientMemberId: memberId,
      sentAt: instance.updatedAt,
      title: `抄送：${instance.title}`,
    })),
  );
}

function readRecipeNumber(instanceId: string): number {
  return Number(instanceId.slice(-3)) - 100;
}

function createInstanceSeed(
  recipe: FilterableExpenseRecipe,
): FilterableExpenseInstanceSeed {
  const vendorLabel = readVendorLabel(recipe.vendorId);
  const startedAt = `${recipe.startDate}T01:30:00.000Z`;
  const updatedAt = `${recipe.updateDate}T03:00:00.000Z`;
  const completedAt = recipe.completedDate
    ? `${recipe.completedDate}T07:45:00.000Z`
    : null;
  const amountEntry: Readonly<Record<string, FormFieldValue>> =
    recipe.amountTwd === undefined ? {} : { amountTwd: recipe.amountTwd };

  return {
    ccMemberIds: recipe.ccMemberIds,
    completedAt,
    formData: {
      applyDate: recipe.applyDate,
      companyCode: recipe.companyCode,
      demandDept: FILTERABLE_EXPENSE_ORG_UNIT_IDS[recipe.dept],
      items: recipe.items.map(([sku, qty, memo]) => ({ memo, qty, sku })),
      note: recipe.note,
      requestType: recipe.requestType,
      vendor: recipe.vendorId,
      ...amountEntry,
    },
    id: recipe.id,
    initiatorMemberId: recipe.initiatorMemberId,
    optionSnapshot: {
      vendor: createVendorSnapshot(recipe.vendorId, updatedAt),
    },
    startedAt,
    state: recipe.state,
    tasks: createTaskSeeds(recipe, startedAt, updatedAt),
    title: `請款 ${String(recipe.n).padStart(2, '0')}：${vendorLabel}`,
    token: createTokenSeed(recipe, startedAt, completedAt),
    updatedAt,
  };
}

function createTokenSeed(
  recipe: FilterableExpenseRecipe,
  startedAt: string,
  completedAt: string | null,
): FilterableExpenseTokenSeed {
  const id = tokenIdFor(recipe.id);

  if (recipe.state === 'RUNNING') {
    return {
      consumedAt: null,
      createdAt: startedAt,
      currentNodeId: recipe.runningAt ?? DEPT_NODE_ID,
      id,
      status: 'ACTIVE',
    };
  }

  return {
    consumedAt: completedAt,
    createdAt: startedAt,
    currentNodeId:
      recipe.state === 'APPROVED' ? FINANCE_NODE_ID : DEPT_NODE_ID,
    id,
    status: 'CONSUMED',
  };
}

/**
 * Task rows per case: the department task always exists; the finance task
 * exists once the case reached finance (RUNNING at finance, or APPROVED).
 * Terminal states follow what happened at each node.
 */
function createTaskSeeds(
  recipe: FilterableExpenseRecipe,
  startedAt: string,
  updatedAt: string,
): readonly FilterableExpenseTaskSeed[] {
  const slaDueAt = addDaysIso(startedAt, 2);
  const deptTask: FilterableExpenseTaskSeed = {
    assigneeMemberId: FILTERABLE_EXPENSE_DEPT_MANAGER_MEMBER_ID,
    completedAt:
      recipe.state === 'RUNNING' && recipe.runningAt !== FINANCE_NODE_ID
        ? null
        : updatedAt,
    createdAt: startedAt,
    id: taskIdFor(recipe.id, 1),
    nodeId: DEPT_NODE_ID,
    openedAt: startedAt,
    slaDueAt,
    status: readDeptTaskStatus(recipe),
  };

  if (recipe.state === 'RUNNING' && recipe.runningAt !== FINANCE_NODE_ID) {
    return [deptTask];
  }

  if (recipe.state === 'CANCELLED') {
    return [{ ...deptTask, status: 'CANCELLED' }];
  }

  if (recipe.state === 'REJECTED' || recipe.state === 'RETURNED') {
    return [deptTask];
  }

  const financeTask: FilterableExpenseTaskSeed = {
    assigneeMemberId: FILTERABLE_EXPENSE_FINANCE_REVIEWER_MEMBER_ID,
    completedAt: recipe.state === 'APPROVED' ? updatedAt : null,
    createdAt: updatedAt,
    id: taskIdFor(recipe.id, 2),
    nodeId: FINANCE_NODE_ID,
    openedAt: updatedAt,
    slaDueAt: addDaysIso(updatedAt, 2),
    status: recipe.state === 'APPROVED' ? 'COMPLETED' : 'IN_PROGRESS',
  };

  return [deptTask, financeTask];
}

function readDeptTaskStatus(
  recipe: FilterableExpenseRecipe,
): FilterableExpenseTaskSeed['status'] {
  if (recipe.state === 'RUNNING') {
    return recipe.runningAt === FINANCE_NODE_ID ? 'COMPLETED' : 'IN_PROGRESS';
  }

  return recipe.state === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
}

function createVendorSnapshot(
  vendorId: string,
  validatedAt: string,
): FormDataSourceValueSnapshot {
  const option = DEMO_VENDOR_OPTIONS.find((item) => item.value === vendorId);

  if (!option) {
    throw new Error(`Unknown demo vendor ${vendorId}`);
  }

  return {
    bindingHash: createHash('sha256')
      .update(
        JSON.stringify({
          dataSourceKey: VENDOR_DATA_SOURCE_KEY,
          dataSourceVersion: 1,
          values: [],
        }),
      )
      .digest('hex'),
    dataSourceKey: VENDOR_DATA_SOURCE_KEY,
    dataSourceVersion: 1,
    options: [{ label: option.label, value: option.value }],
    revalidationPolicy: 'WHEN_VALUE_OR_BINDINGS_CHANGE',
    validatedAt,
  };
}

function readVendorLabel(vendorId: string): string {
  const option = DEMO_VENDOR_OPTIONS.find((item) => item.value === vendorId);

  return option?.label ?? vendorId;
}

function tokenIdFor(instanceId: string): string {
  return `61000000-0000-4000-8000-000000000${instanceId.slice(-3)}`;
}

function taskIdFor(instanceId: string, nodeIndex: number): string {
  return `62000000-0000-4000-8000-00000000${instanceId.slice(-3)}${nodeIndex}`;
}

function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}
