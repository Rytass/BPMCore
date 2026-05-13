import 'reflect-metadata';
import { DataSource, DataSourceOptions, QueryRunner } from 'typeorm';
import { buildDataSourceOptionsFromVaultEnv } from '../libs/bpm-core/src/lib/database/typeorm.config';

type SqlScalar = string | number | boolean | null | readonly string[];

type SqlCell = Readonly<{
  cast?: 'jsonb' | 'ltree' | 'uuid[]';
  value: SqlScalar;
}>;

type SeedRow = Readonly<Record<string, SqlCell>>;

type MemberSeed = Readonly<{
  email: string;
  memberId: string;
  name: string;
  orgUnitCode: string;
  positionCode: string;
}>;

const NOW = '2026-05-13T09:00:00.000Z';
const CACHE_EXPIRES_AT = '2026-12-31T23:59:59.000Z';
const EFFECTIVE_FROM = '2026-01-01';

const ORG_UNIT_IDS = {
  ACCOUNTING: '10000000-0000-4000-8000-000000000004',
  CEO_OFFICE: '10000000-0000-4000-8000-000000000002',
  CUSTOMER_SUCCESS: '10000000-0000-4000-8000-000000000009',
  FINANCE: '10000000-0000-4000-8000-000000000003',
  FINANCIAL_PLANNING: '10000000-0000-4000-8000-000000000005',
  HR: '10000000-0000-4000-8000-000000000006',
  IT: '10000000-0000-4000-8000-000000000010',
  PRODUCT: '10000000-0000-4000-8000-000000000011',
  ROOT: '10000000-0000-4000-8000-000000000001',
  SALES: '10000000-0000-4000-8000-000000000008',
} as const;

const POSITION_IDS = {
  ACCOUNT_EXECUTIVE: '20000000-0000-4000-8000-000000000008',
  CEO: '20000000-0000-4000-8000-000000000001',
  DEPARTMENT_HEAD: '20000000-0000-4000-8000-000000000003',
  FINANCE_SPECIALIST: '20000000-0000-4000-8000-000000000006',
  HR_SPECIALIST: '20000000-0000-4000-8000-000000000007',
  IT_ENGINEER: '20000000-0000-4000-8000-000000000009',
  PRODUCT_MANAGER: '20000000-0000-4000-8000-000000000010',
  SENIOR_SPECIALIST: '20000000-0000-4000-8000-000000000005',
  TEAM_LEAD: '20000000-0000-4000-8000-000000000004',
  VP: '20000000-0000-4000-8000-000000000002',
} as const;

const CATEGORY_IDS = {
  FINANCE: '40000000-0000-4000-8000-000000000001',
  HR: '40000000-0000-4000-8000-000000000002',
  IT: '40000000-0000-4000-8000-000000000003',
  SALES: '40000000-0000-4000-8000-000000000004',
  PROCUREMENT: '40000000-0000-4000-8000-000000000005',
} as const;

const FORM_IDS = {
  ACCESS: '30000000-0000-4000-8000-000000000003',
  DISCOUNT: '30000000-0000-4000-8000-000000000004',
  EXPENSE: '30000000-0000-4000-8000-000000000001',
  LEAVE: '30000000-0000-4000-8000-000000000002',
  PURCHASE: '30000000-0000-4000-8000-000000000005',
} as const;

const FORM_VERSION_IDS = {
  ACCESS_V1: '31000000-0000-4000-8000-000000000003',
  DISCOUNT_V1: '31000000-0000-4000-8000-000000000004',
  EXPENSE_ARCHIVED: '31000000-0000-4000-8000-000000000006',
  EXPENSE_DRAFT: '31000000-0000-4000-8000-000000000007',
  EXPENSE_V1: '31000000-0000-4000-8000-000000000001',
  LEAVE_V1: '31000000-0000-4000-8000-000000000002',
  PURCHASE_DRAFT: '31000000-0000-4000-8000-000000000005',
} as const;

const TEMPLATE_IDS = {
  ACCESS: '50000000-0000-4000-8000-000000000003',
  DISCOUNT: '50000000-0000-4000-8000-000000000004',
  EXPENSE: '50000000-0000-4000-8000-000000000001',
  LEAVE: '50000000-0000-4000-8000-000000000002',
  PURCHASE: '50000000-0000-4000-8000-000000000005',
} as const;

const TEMPLATE_VERSION_IDS = {
  ACCESS_V1: '51000000-0000-4000-8000-000000000003',
  DISCOUNT_V1: '51000000-0000-4000-8000-000000000004',
  EXPENSE_ARCHIVED: '51000000-0000-4000-8000-000000000006',
  EXPENSE_V1: '51000000-0000-4000-8000-000000000001',
  LEAVE_V1: '51000000-0000-4000-8000-000000000002',
  PURCHASE_DRAFT: '51000000-0000-4000-8000-000000000005',
} as const;

const INSTANCE_IDS = {
  ACCESS_RETURNED: '60000000-0000-4000-8000-000000000005',
  DISCOUNT_REJECTED: '60000000-0000-4000-8000-000000000004',
  EXPENSE_APPROVED: '60000000-0000-4000-8000-000000000003',
  EXPENSE_RUNNING: '60000000-0000-4000-8000-000000000001',
  LEAVE_APPROVED: '60000000-0000-4000-8000-000000000006',
  PURCHASE_CANCELLED: '60000000-0000-4000-8000-000000000007',
  PURCHASE_RUNNING: '60000000-0000-4000-8000-000000000002',
} as const;

const TOKEN_IDS = {
  ACCESS_RETURNED: '61000000-0000-4000-8000-000000000005',
  DISCOUNT_REJECTED: '61000000-0000-4000-8000-000000000004',
  EXPENSE_APPROVED: '61000000-0000-4000-8000-000000000003',
  EXPENSE_RUNNING_FINANCE: '61000000-0000-4000-8000-000000000001',
  LEAVE_APPROVED: '61000000-0000-4000-8000-000000000006',
  PURCHASE_CANCELLED: '61000000-0000-4000-8000-000000000007',
  PURCHASE_RUNNING_CEO: '61000000-0000-4000-8000-000000000002',
} as const;

const TASK_IDS = {
  ACCESS_RETURNED_IT: '62000000-0000-4000-8000-000000000006',
  DISCOUNT_REJECTED_MANAGER: '62000000-0000-4000-8000-000000000005',
  EXPENSE_APPROVED_FINANCE: '62000000-0000-4000-8000-000000000004',
  EXPENSE_APPROVED_MANAGER: '62000000-0000-4000-8000-000000000003',
  EXPENSE_RUNNING_FINANCE: '62000000-0000-4000-8000-000000000002',
  EXPENSE_RUNNING_MANAGER: '62000000-0000-4000-8000-000000000001',
  LEAVE_APPROVED_MANAGER: '62000000-0000-4000-8000-000000000007',
  PURCHASE_CANCELLED_MANAGER: '62000000-0000-4000-8000-000000000009',
  PURCHASE_RUNNING_CEO: '62000000-0000-4000-8000-000000000008',
} as const;

const MEMBERS: readonly MemberSeed[] = [
  {
    email: 'lin.ceo@example.internal',
    memberId: 'member-001',
    name: '林執行長',
    orgUnitCode: 'CEO-OFFICE',
    positionCode: 'CEO',
  },
  {
    email: 'chen.cfo@example.internal',
    memberId: 'member-101',
    name: '陳財務長',
    orgUnitCode: 'FIN',
    positionCode: 'VP',
  },
  {
    email: 'wu.ap@example.internal',
    memberId: 'member-102',
    name: '吳應付帳款專員',
    orgUnitCode: 'FIN-AP',
    positionCode: 'FINANCE_SPECIALIST',
  },
  {
    email: 'li.fpna@example.internal',
    memberId: 'member-103',
    name: '李財務分析師',
    orgUnitCode: 'FIN-FPNA',
    positionCode: 'SENIOR_SPECIALIST',
  },
  {
    email: 'huang.hr@example.internal',
    memberId: 'member-201',
    name: '黃人資主管',
    orgUnitCode: 'HR',
    positionCode: 'DEPARTMENT_HEAD',
  },
  {
    email: 'tsai.hr@example.internal',
    memberId: 'member-202',
    name: '蔡人資專員',
    orgUnitCode: 'HR',
    positionCode: 'HR_SPECIALIST',
  },
  {
    email: 'chang.sales@example.internal',
    memberId: 'member-301',
    name: '張業務主管',
    orgUnitCode: 'SALES',
    positionCode: 'DEPARTMENT_HEAD',
  },
  {
    email: 'wang.ae@example.internal',
    memberId: 'member-302',
    name: '王客戶經理',
    orgUnitCode: 'SALES',
    positionCode: 'ACCOUNT_EXECUTIVE',
  },
  {
    email: 'lu.cs@example.internal',
    memberId: 'member-303',
    name: '盧客戶成功顧問',
    orgUnitCode: 'CUSTOMER-SUCCESS',
    positionCode: 'SENIOR_SPECIALIST',
  },
  {
    email: 'hsu.it@example.internal',
    memberId: 'member-401',
    name: '許資訊主管',
    orgUnitCode: 'IT',
    positionCode: 'DEPARTMENT_HEAD',
  },
  {
    email: 'ko.it@example.internal',
    memberId: 'member-402',
    name: '柯系統工程師',
    orgUnitCode: 'IT',
    positionCode: 'IT_ENGINEER',
  },
  {
    email: 'sun.product@example.internal',
    memberId: 'member-501',
    name: '孫產品主管',
    orgUnitCode: 'PRODUCT',
    positionCode: 'DEPARTMENT_HEAD',
  },
  {
    email: 'yang.pm@example.internal',
    memberId: 'member-502',
    name: '楊產品經理',
    orgUnitCode: 'PRODUCT',
    positionCode: 'PRODUCT_MANAGER',
  },
];

const ORG_UNIT_CODE_TO_ID: Readonly<Record<string, string>> = {
  'CEO-OFFICE': ORG_UNIT_IDS.CEO_OFFICE,
  'CUSTOMER-SUCCESS': ORG_UNIT_IDS.CUSTOMER_SUCCESS,
  FIN: ORG_UNIT_IDS.FINANCE,
  'FIN-AP': ORG_UNIT_IDS.ACCOUNTING,
  'FIN-FPNA': ORG_UNIT_IDS.FINANCIAL_PLANNING,
  HR: ORG_UNIT_IDS.HR,
  IT: ORG_UNIT_IDS.IT,
  PRODUCT: ORG_UNIT_IDS.PRODUCT,
  SALES: ORG_UNIT_IDS.SALES,
};

const POSITION_CODE_TO_ID: Readonly<Record<string, string>> = {
  ACCOUNT_EXECUTIVE: POSITION_IDS.ACCOUNT_EXECUTIVE,
  CEO: POSITION_IDS.CEO,
  DEPARTMENT_HEAD: POSITION_IDS.DEPARTMENT_HEAD,
  FINANCE_SPECIALIST: POSITION_IDS.FINANCE_SPECIALIST,
  HR_SPECIALIST: POSITION_IDS.HR_SPECIALIST,
  IT_ENGINEER: POSITION_IDS.IT_ENGINEER,
  PRODUCT_MANAGER: POSITION_IDS.PRODUCT_MANAGER,
  SENIOR_SPECIALIST: POSITION_IDS.SENIOR_SPECIALIST,
  VP: POSITION_IDS.VP,
};

const EXPENSE_FORM_SCHEMA = {
  fields: [
    {
      fieldKey: 'vendorName',
      label: '供應商名稱',
      placeholder: '例如 Cloud CRM Taiwan',
      required: true,
      type: 'text',
    },
    {
      fieldKey: 'amount',
      label: '請款金額',
      minimum: 1,
      required: true,
      type: 'money',
    },
    {
      fieldKey: 'invoiceDate',
      label: '發票日期',
      required: true,
      type: 'date',
    },
    {
      fieldKey: 'paymentType',
      label: '付款類型',
      options: [
        { label: '軟體訂閱', value: 'software' },
        { label: '差旅費用', value: 'travel' },
        { label: '供應商請款', value: 'vendor' },
      ],
      required: true,
      type: 'select',
    },
    {
      acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      fieldKey: 'receipt',
      label: '憑證附件',
      maxFiles: 3,
      required: false,
      type: 'file_upload',
    },
    {
      fieldKey: 'reason',
      label: '請款說明',
      required: true,
      type: 'textarea',
    },
  ],
  schemaVersion: 1,
} as const;

const LEAVE_FORM_SCHEMA = {
  fields: [
    {
      fieldKey: 'leaveType',
      label: '假別',
      options: [
        { label: '特休', value: 'annual' },
        { label: '病假', value: 'sick' },
        { label: '家庭照顧', value: 'family' },
      ],
      required: true,
      type: 'select',
    },
    { fieldKey: 'startDate', label: '開始日期', required: true, type: 'date' },
    { fieldKey: 'endDate', label: '結束日期', required: true, type: 'date' },
    {
      fieldKey: 'handoverNote',
      label: '交接事項',
      required: true,
      type: 'textarea',
    },
  ],
  schemaVersion: 1,
} as const;

const ACCESS_FORM_SCHEMA = {
  fields: [
    {
      fieldKey: 'systemName',
      label: '系統名稱',
      options: [
        { label: 'CRM', value: 'crm' },
        { label: '資料倉儲', value: 'warehouse' },
        { label: '雲端主控台', value: 'cloud-console' },
      ],
      required: true,
      type: 'select',
    },
    {
      fieldKey: 'permissionLevel',
      label: '權限等級',
      options: [
        { label: '唯讀', value: 'read' },
        { label: '編輯', value: 'write' },
        { label: '管理員', value: 'admin' },
      ],
      required: true,
      type: 'radio',
    },
    {
      fieldKey: 'businessReason',
      label: '申請原因',
      required: true,
      type: 'textarea',
    },
  ],
  schemaVersion: 1,
} as const;

const DISCOUNT_FORM_SCHEMA = {
  fields: [
    {
      fieldKey: 'customerName',
      label: '客戶名稱',
      required: true,
      type: 'text',
    },
    {
      fieldKey: 'contractAmount',
      label: '合約金額',
      minimum: 1,
      required: true,
      type: 'money',
    },
    {
      fieldKey: 'discountRate',
      label: '折扣比例',
      maximum: 50,
      minimum: 0,
      required: true,
      type: 'number',
    },
    {
      fieldKey: 'reason',
      label: '商務理由',
      required: true,
      type: 'textarea',
    },
  ],
  schemaVersion: 1,
} as const;

const PURCHASE_FORM_SCHEMA = {
  fields: [
    { fieldKey: 'itemName', label: '採購項目', required: true, type: 'text' },
    { fieldKey: 'amount', label: '採購金額', required: true, type: 'money' },
    {
      fieldKey: 'needBy',
      label: '需求日期',
      required: true,
      type: 'date',
    },
    {
      fieldKey: 'reason',
      label: '採購原因',
      required: true,
      type: 'textarea',
    },
  ],
  schemaVersion: 1,
} as const;

const EXPENSE_FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'vendorName', width: 'HALF' },
    { fieldKey: 'amount', width: 'HALF' },
    { fieldKey: 'invoiceDate', width: 'HALF' },
    { fieldKey: 'paymentType', width: 'HALF' },
    { fieldKey: 'receipt', width: 'FULL' },
    { fieldKey: 'reason', width: 'FULL' },
  ],
  schemaVersion: 1,
} as const;

const LEAVE_FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'leaveType', width: 'HALF' },
    { fieldKey: 'startDate', width: 'HALF' },
    { fieldKey: 'endDate', width: 'HALF' },
    { fieldKey: 'handoverNote', width: 'FULL' },
  ],
  schemaVersion: 1,
} as const;

const ACCESS_FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'systemName', width: 'HALF' },
    { fieldKey: 'permissionLevel', width: 'HALF' },
    { fieldKey: 'businessReason', width: 'FULL' },
  ],
  schemaVersion: 1,
} as const;

const DISCOUNT_FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'customerName', width: 'HALF' },
    { fieldKey: 'contractAmount', width: 'HALF' },
    { fieldKey: 'discountRate', width: 'HALF' },
    { fieldKey: 'reason', width: 'FULL' },
  ],
  schemaVersion: 1,
} as const;

const PURCHASE_FORM_UI_SCHEMA = {
  layout: [
    { fieldKey: 'itemName', width: 'HALF' },
    { fieldKey: 'amount', width: 'HALF' },
    { fieldKey: 'needBy', width: 'HALF' },
    { fieldKey: 'reason', width: 'FULL' },
  ],
  schemaVersion: 1,
} as const;

const EXPENSE_WORKFLOW = createWorkflowDefinition({
  approvalNodes: [
    {
      id: 'manager_review',
      label: '直屬主管簽核',
      resolver: {
        baseFromInitiator: true,
        fallback: { memberId: 'member-001', type: 'DIRECT' },
        levelsUp: 1,
        type: 'ORG_MANAGER',
      },
      x: 220,
      y: 0,
    },
    {
      id: 'finance_review',
      label: '財務覆核',
      resolver: {
        fallback: { memberId: 'member-101', type: 'DIRECT' },
        orgUnitId: ORG_UNIT_IDS.FINANCE,
        type: 'ORG_UNIT_MANAGER',
      },
      x: 460,
      y: 0,
    },
  ],
});

const LEAVE_WORKFLOW = createWorkflowDefinition({
  approvalNodes: [
    {
      id: 'manager_review',
      label: '主管簽核',
      resolver: {
        baseFromInitiator: true,
        fallback: { memberId: 'member-201', type: 'DIRECT' },
        levelsUp: 1,
        type: 'ORG_MANAGER',
      },
      x: 220,
      y: 0,
    },
    {
      id: 'hr_record',
      label: '人資備查',
      resolver: { memberIds: ['member-201'], type: 'DIRECT' },
      x: 460,
      y: 0,
    },
  ],
});

const ACCESS_WORKFLOW = createWorkflowDefinition({
  approvalNodes: [
    {
      id: 'manager_review',
      label: '部門主管確認',
      resolver: {
        baseFromInitiator: true,
        fallback: { memberId: 'member-401', type: 'DIRECT' },
        levelsUp: 1,
        type: 'ORG_MANAGER',
      },
      x: 220,
      y: 0,
    },
    {
      id: 'it_security_review',
      label: '資訊安全覆核',
      resolver: { memberIds: ['member-401'], type: 'DIRECT' },
      x: 460,
      y: 0,
    },
  ],
});

const DISCOUNT_WORKFLOW = createWorkflowDefinition({
  approvalNodes: [
    {
      id: 'sales_manager_review',
      label: '業務主管簽核',
      resolver: {
        baseFromInitiator: true,
        fallback: { memberId: 'member-301', type: 'DIRECT' },
        levelsUp: 1,
        type: 'ORG_MANAGER',
      },
      x: 220,
      y: 0,
    },
    {
      id: 'ceo_review',
      label: '執行長核准',
      resolver: { memberIds: ['member-001'], type: 'DIRECT' },
      x: 460,
      y: 0,
    },
  ],
});

const PURCHASE_WORKFLOW = createWorkflowDefinition({
  approvalNodes: [
    {
      id: 'manager_review',
      label: '部門主管簽核',
      resolver: {
        baseFromInitiator: true,
        fallback: { memberId: 'member-001', type: 'DIRECT' },
        levelsUp: 1,
        type: 'ORG_MANAGER',
      },
      x: 220,
      y: 0,
    },
    {
      id: 'ceo_review',
      label: '預算核准',
      resolver: { memberIds: ['member-001'], type: 'DIRECT' },
      x: 460,
      y: 0,
    },
  ],
});

async function main(): Promise<void> {
  const options = await buildDataSourceOptionsFromVaultEnv(process.env);
  const dataSource = new DataSource(options);

  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
    await resetAndSeed(dataSource, readSchema(options));
  } finally {
    await dataSource.destroy();
  }
}

async function resetAndSeed(
  dataSource: DataSource,
  schema: string,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    await queryRunner.query(
      `SET search_path TO ${quoteIdentifier(schema)}, public`,
    );
    await truncateDemoTables(queryRunner);
    await seedOrganization(queryRunner);
    await seedForms(queryRunner);
    await seedTemplates(queryRunner);
    await seedRuntimeData(queryRunner);
    await queryRunner.commitTransaction();
  } catch (error: unknown) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

async function truncateDemoTables(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    TRUNCATE TABLE
      attachments,
      notifications,
      notification_preferences,
      task_decisions,
      signatures,
      activity_logs,
      tasks,
      workflow_tokens,
      approval_instances,
      delegation_rules,
      approval_template_versions,
      approval_templates,
      approval_template_categories,
      form_definition_versions,
      form_definitions,
      manager_resolutions,
      memberships,
      positions,
      org_units,
      member_metadata_cache
    RESTART IDENTITY CASCADE
  `);
}

async function seedOrganization(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'org_units',
    [
      'id',
      'parent_id',
      'code',
      'name',
      'type',
      'path',
      'metadata',
      'created_at',
      'updated_at',
    ],
    [
      {
        code: text('COMPANY'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.ROOT),
        metadata: jsonb({ costCenter: 'ROOT', location: '台北總部' }),
        name: text('星曜科技股份有限公司'),
        parent_id: text(null),
        path: ltree('company'),
        type: text('company'),
        updated_at: text(NOW),
      },
      {
        code: text('CEO-OFFICE'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.CEO_OFFICE),
        metadata: jsonb({ costCenter: 'CEO-000', location: '台北總部' }),
        name: text('總經理室'),
        parent_id: text(ORG_UNIT_IDS.ROOT),
        path: ltree('company.ceo_office'),
        type: text('department'),
        updated_at: text(NOW),
      },
      {
        code: text('FIN'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.FINANCE),
        metadata: jsonb({ costCenter: 'FIN-100', location: '台北總部' }),
        name: text('財務處'),
        parent_id: text(ORG_UNIT_IDS.ROOT),
        path: ltree('company.finance'),
        type: text('division'),
        updated_at: text(NOW),
      },
      {
        code: text('FIN-AP'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.ACCOUNTING),
        metadata: jsonb({ costCenter: 'FIN-110', location: '台北總部' }),
        name: text('會計與應付帳款組'),
        parent_id: text(ORG_UNIT_IDS.FINANCE),
        path: ltree('company.finance.accounting'),
        type: text('team'),
        updated_at: text(NOW),
      },
      {
        code: text('FIN-FPNA'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.FINANCIAL_PLANNING),
        metadata: jsonb({ costCenter: 'FIN-120', location: '台北總部' }),
        name: text('財務規劃分析組'),
        parent_id: text(ORG_UNIT_IDS.FINANCE),
        path: ltree('company.finance.fpna'),
        type: text('team'),
        updated_at: text(NOW),
      },
      {
        code: text('HR'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.HR),
        metadata: jsonb({ costCenter: 'HR-200', location: '台北總部' }),
        name: text('人資行政處'),
        parent_id: text(ORG_UNIT_IDS.ROOT),
        path: ltree('company.hr'),
        type: text('division'),
        updated_at: text(NOW),
      },
      {
        code: text('SALES'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.SALES),
        metadata: jsonb({ costCenter: 'SAL-300', location: '台北總部' }),
        name: text('業務處'),
        parent_id: text(ORG_UNIT_IDS.ROOT),
        path: ltree('company.sales'),
        type: text('division'),
        updated_at: text(NOW),
      },
      {
        code: text('CUSTOMER-SUCCESS'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.CUSTOMER_SUCCESS),
        metadata: jsonb({ costCenter: 'CS-310', location: '台北總部' }),
        name: text('客戶成功部'),
        parent_id: text(ORG_UNIT_IDS.SALES),
        path: ltree('company.sales.customer_success'),
        type: text('department'),
        updated_at: text(NOW),
      },
      {
        code: text('IT'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.IT),
        metadata: jsonb({ costCenter: 'IT-400', location: '台北總部' }),
        name: text('資訊平台處'),
        parent_id: text(ORG_UNIT_IDS.ROOT),
        path: ltree('company.it'),
        type: text('division'),
        updated_at: text(NOW),
      },
      {
        code: text('PRODUCT'),
        created_at: text(NOW),
        id: text(ORG_UNIT_IDS.PRODUCT),
        metadata: jsonb({ costCenter: 'PD-500', location: '台北總部' }),
        name: text('產品研發處'),
        parent_id: text(ORG_UNIT_IDS.ROOT),
        path: ltree('company.product'),
        type: text('division'),
        updated_at: text(NOW),
      },
    ],
  );

  await insertRows(
    queryRunner,
    'positions',
    ['id', 'code', 'name', 'level', 'metadata', 'created_at', 'updated_at'],
    [
      positionRow(POSITION_IDS.CEO, 'CEO', '執行長', 100, 'unlimited'),
      positionRow(POSITION_IDS.VP, 'VP', '副總經理 / 處長', 90, 1000000),
      positionRow(
        POSITION_IDS.DEPARTMENT_HEAD,
        'DEPARTMENT_HEAD',
        '部門主管',
        80,
        500000,
      ),
      positionRow(POSITION_IDS.TEAM_LEAD, 'TEAM_LEAD', '組長', 60, 150000),
      positionRow(
        POSITION_IDS.SENIOR_SPECIALIST,
        'SENIOR_SPECIALIST',
        '資深專員',
        50,
        80000,
      ),
      positionRow(
        POSITION_IDS.FINANCE_SPECIALIST,
        'FINANCE_SPECIALIST',
        '財務專員',
        45,
        50000,
      ),
      positionRow(
        POSITION_IDS.HR_SPECIALIST,
        'HR_SPECIALIST',
        '人資專員',
        45,
        50000,
      ),
      positionRow(
        POSITION_IDS.ACCOUNT_EXECUTIVE,
        'ACCOUNT_EXECUTIVE',
        '客戶經理',
        45,
        100000,
      ),
      positionRow(
        POSITION_IDS.IT_ENGINEER,
        'IT_ENGINEER',
        '系統工程師',
        45,
        60000,
      ),
      positionRow(
        POSITION_IDS.PRODUCT_MANAGER,
        'PRODUCT_MANAGER',
        '產品經理',
        55,
        120000,
      ),
    ],
  );

  await insertRows(
    queryRunner,
    'member_metadata_cache',
    ['member_id', 'metadata', 'fetched_at', 'expires_at'],
    MEMBERS.map(
      (member): SeedRow => ({
        expires_at: text(CACHE_EXPIRES_AT),
        fetched_at: text(NOW),
        member_id: text(member.memberId),
        metadata: jsonb({
          customFields: {
            employeeNo: member.memberId.replace('member-', 'EMP-'),
            site: '台北總部',
          },
          email: member.email,
          memberId: member.memberId,
          name: member.name,
          positionId: member.positionCode,
          primaryOrgUnitId: member.orgUnitCode,
        }),
      }),
    ),
  );

  await insertRows(
    queryRunner,
    'memberships',
    [
      'member_id',
      'org_unit_id',
      'position_id',
      'is_primary',
      'effective_from',
      'effective_to',
      'created_at',
      'updated_at',
    ],
    MEMBERS.map(
      (member): SeedRow => ({
        created_at: text(NOW),
        effective_from: text(EFFECTIVE_FROM),
        effective_to: text(null),
        is_primary: bool(true),
        member_id: text(member.memberId),
        org_unit_id: text(
          readRequiredValue(ORG_UNIT_CODE_TO_ID, member.orgUnitCode),
        ),
        position_id: text(
          readRequiredValue(POSITION_CODE_TO_ID, member.positionCode),
        ),
        updated_at: text(NOW),
      }),
    ),
  );

  await insertRows(
    queryRunner,
    'manager_resolutions',
    [
      'scope_type',
      'scope_id',
      'manager_member_id',
      'priority',
      'effective_from',
      'effective_to',
      'created_at',
    ],
    [
      managerResolution('ORG_UNIT', ORG_UNIT_IDS.ROOT, 'member-001', 10),
      managerResolution('ORG_UNIT', ORG_UNIT_IDS.CEO_OFFICE, 'member-001', 100),
      managerResolution('ORG_UNIT', ORG_UNIT_IDS.FINANCE, 'member-101', 100),
      managerResolution('ORG_UNIT', ORG_UNIT_IDS.ACCOUNTING, 'member-101', 150),
      managerResolution(
        'ORG_UNIT',
        ORG_UNIT_IDS.FINANCIAL_PLANNING,
        'member-101',
        150,
      ),
      managerResolution('ORG_UNIT', ORG_UNIT_IDS.HR, 'member-201', 100),
      managerResolution('ORG_UNIT', ORG_UNIT_IDS.SALES, 'member-301', 100),
      managerResolution(
        'ORG_UNIT',
        ORG_UNIT_IDS.CUSTOMER_SUCCESS,
        'member-301',
        150,
      ),
      managerResolution('ORG_UNIT', ORG_UNIT_IDS.IT, 'member-401', 100),
      managerResolution('ORG_UNIT', ORG_UNIT_IDS.PRODUCT, 'member-501', 100),
      managerResolution('MEMBER', 'member-102', 'member-101', 220),
      managerResolution('MEMBER', 'member-402', 'member-401', 220),
      managerResolution(
        'POSITION',
        POSITION_IDS.DEPARTMENT_HEAD,
        'member-001',
        80,
      ),
      managerResolution('POSITION', POSITION_IDS.VP, 'member-001', 90),
    ],
  );
}

async function seedForms(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'form_definitions',
    [
      'id',
      'name',
      'description',
      'current_version_id',
      'created_by_member_id',
      'created_at',
      'updated_at',
    ],
    [
      formDefinitionRow(
        FORM_IDS.EXPENSE,
        '費用請款單',
        '日常費用、供應商請款與軟體訂閱付款。',
        'member-101',
      ),
      formDefinitionRow(
        FORM_IDS.LEAVE,
        '請假申請單',
        '特休、病假與家庭照顧假申請。',
        'member-201',
      ),
      formDefinitionRow(
        FORM_IDS.ACCESS,
        '系統權限申請單',
        'CRM、資料倉儲與雲端主控台權限申請。',
        'member-401',
      ),
      formDefinitionRow(
        FORM_IDS.DISCOUNT,
        '客戶折扣申請單',
        '業務客戶折扣、合約例外條件申請。',
        'member-301',
      ),
      formDefinitionRow(
        FORM_IDS.PURCHASE,
        '採購申請單',
        '設備、軟體與專案採購申請草稿。',
        'member-101',
      ),
    ],
  );

  await insertRows(
    queryRunner,
    'form_definition_versions',
    [
      'id',
      'form_definition_id',
      'version',
      'status',
      'schema',
      'ui_schema',
      'published_at',
      'published_by_member_id',
      'archived_at',
      'created_at',
      'updated_at',
    ],
    [
      formVersionRow(
        FORM_VERSION_IDS.EXPENSE_V1,
        FORM_IDS.EXPENSE,
        1,
        'PUBLISHED',
        EXPENSE_FORM_SCHEMA,
        EXPENSE_FORM_UI_SCHEMA,
        '2026-05-01T02:00:00.000Z',
        'member-101',
        null,
      ),
      formVersionRow(
        FORM_VERSION_IDS.EXPENSE_ARCHIVED,
        FORM_IDS.EXPENSE,
        0,
        'ARCHIVED',
        EXPENSE_FORM_SCHEMA,
        EXPENSE_FORM_UI_SCHEMA,
        '2026-04-10T02:00:00.000Z',
        'member-101',
        '2026-05-01T01:50:00.000Z',
      ),
      formVersionRow(
        FORM_VERSION_IDS.EXPENSE_DRAFT,
        FORM_IDS.EXPENSE,
        2,
        'DRAFT',
        EXPENSE_FORM_SCHEMA,
        EXPENSE_FORM_UI_SCHEMA,
        null,
        null,
        null,
      ),
      formVersionRow(
        FORM_VERSION_IDS.LEAVE_V1,
        FORM_IDS.LEAVE,
        1,
        'PUBLISHED',
        LEAVE_FORM_SCHEMA,
        LEAVE_FORM_UI_SCHEMA,
        '2026-05-01T03:00:00.000Z',
        'member-201',
        null,
      ),
      formVersionRow(
        FORM_VERSION_IDS.ACCESS_V1,
        FORM_IDS.ACCESS,
        1,
        'PUBLISHED',
        ACCESS_FORM_SCHEMA,
        ACCESS_FORM_UI_SCHEMA,
        '2026-05-02T03:00:00.000Z',
        'member-401',
        null,
      ),
      formVersionRow(
        FORM_VERSION_IDS.DISCOUNT_V1,
        FORM_IDS.DISCOUNT,
        1,
        'PUBLISHED',
        DISCOUNT_FORM_SCHEMA,
        DISCOUNT_FORM_UI_SCHEMA,
        '2026-05-02T04:00:00.000Z',
        'member-301',
        null,
      ),
      formVersionRow(
        FORM_VERSION_IDS.PURCHASE_DRAFT,
        FORM_IDS.PURCHASE,
        1,
        'DRAFT',
        PURCHASE_FORM_SCHEMA,
        PURCHASE_FORM_UI_SCHEMA,
        null,
        null,
        null,
      ),
    ],
  );

  await updateCurrentVersion(
    queryRunner,
    'form_definitions',
    FORM_IDS.EXPENSE,
    FORM_VERSION_IDS.EXPENSE_V1,
  );
  await updateCurrentVersion(
    queryRunner,
    'form_definitions',
    FORM_IDS.LEAVE,
    FORM_VERSION_IDS.LEAVE_V1,
  );
  await updateCurrentVersion(
    queryRunner,
    'form_definitions',
    FORM_IDS.ACCESS,
    FORM_VERSION_IDS.ACCESS_V1,
  );
  await updateCurrentVersion(
    queryRunner,
    'form_definitions',
    FORM_IDS.DISCOUNT,
    FORM_VERSION_IDS.DISCOUNT_V1,
  );
  await updateCurrentVersion(
    queryRunner,
    'form_definitions',
    FORM_IDS.PURCHASE,
    FORM_VERSION_IDS.PURCHASE_DRAFT,
  );
}

async function seedTemplates(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'approval_template_categories',
    [
      'id',
      'name',
      'description',
      'is_active',
      'sort_order',
      'created_at',
      'updated_at',
    ],
    [
      categoryRow(
        CATEGORY_IDS.FINANCE,
        '財務請款',
        '費用、採購與預算相關流程。',
        10,
      ),
      categoryRow(
        CATEGORY_IDS.HR,
        '人資行政',
        '請假、人員異動與行政申請。',
        20,
      ),
      categoryRow(
        CATEGORY_IDS.IT,
        '資訊權限',
        '系統權限、資安與設備申請。',
        30,
      ),
      categoryRow(
        CATEGORY_IDS.SALES,
        '業務合約',
        '客戶折扣與合約例外審核。',
        40,
      ),
      categoryRow(
        CATEGORY_IDS.PROCUREMENT,
        '採購管理',
        '採購與供應商管理流程草稿。',
        50,
      ),
    ],
  );

  await insertRows(
    queryRunner,
    'approval_templates',
    [
      'id',
      'name',
      'description',
      'category',
      'category_id',
      'current_version_id',
      'created_by_member_id',
      'created_at',
      'updated_at',
    ],
    [
      templateRow(
        TEMPLATE_IDS.EXPENSE,
        '費用請款簽核',
        '主管先核准，再由財務覆核與付款。',
        '財務請款',
        CATEGORY_IDS.FINANCE,
        'member-101',
      ),
      templateRow(
        TEMPLATE_IDS.LEAVE,
        '請假申請簽核',
        '主管簽核後由人資備查。',
        '人資行政',
        CATEGORY_IDS.HR,
        'member-201',
      ),
      templateRow(
        TEMPLATE_IDS.ACCESS,
        '系統權限申請',
        '部門主管確認需求後，由資訊安全覆核。',
        '資訊權限',
        CATEGORY_IDS.IT,
        'member-401',
      ),
      templateRow(
        TEMPLATE_IDS.DISCOUNT,
        '客戶折扣審核',
        '業務主管與執行長核准大型折扣。',
        '業務合約',
        CATEGORY_IDS.SALES,
        'member-301',
      ),
      templateRow(
        TEMPLATE_IDS.PURCHASE,
        '採購申請草稿',
        '預留採購流程，尚未發佈。',
        '採購管理',
        CATEGORY_IDS.PROCUREMENT,
        'member-101',
      ),
    ],
  );

  await insertRows(
    queryRunner,
    'approval_template_versions',
    [
      'id',
      'template_id',
      'version',
      'status',
      'workflow_definition',
      'form_definition_version_id',
      'initiator_policy_cel',
      'notification_config',
      'sla_defaults',
      'published_at',
      'published_by_member_id',
      'archived_at',
      'created_at',
      'updated_at',
    ],
    [
      templateVersionRow(
        TEMPLATE_VERSION_IDS.EXPENSE_V1,
        TEMPLATE_IDS.EXPENSE,
        1,
        'PUBLISHED',
        EXPENSE_WORKFLOW,
        FORM_VERSION_IDS.EXPENSE_V1,
        '2026-05-01T04:00:00.000Z',
        'member-101',
        null,
      ),
      templateVersionRow(
        TEMPLATE_VERSION_IDS.EXPENSE_ARCHIVED,
        TEMPLATE_IDS.EXPENSE,
        0,
        'ARCHIVED',
        EXPENSE_WORKFLOW,
        FORM_VERSION_IDS.EXPENSE_ARCHIVED,
        '2026-04-01T04:00:00.000Z',
        'member-101',
        '2026-05-01T03:50:00.000Z',
      ),
      templateVersionRow(
        TEMPLATE_VERSION_IDS.LEAVE_V1,
        TEMPLATE_IDS.LEAVE,
        1,
        'PUBLISHED',
        LEAVE_WORKFLOW,
        FORM_VERSION_IDS.LEAVE_V1,
        '2026-05-01T05:00:00.000Z',
        'member-201',
        null,
      ),
      templateVersionRow(
        TEMPLATE_VERSION_IDS.ACCESS_V1,
        TEMPLATE_IDS.ACCESS,
        1,
        'PUBLISHED',
        ACCESS_WORKFLOW,
        FORM_VERSION_IDS.ACCESS_V1,
        '2026-05-02T05:00:00.000Z',
        'member-401',
        null,
      ),
      templateVersionRow(
        TEMPLATE_VERSION_IDS.DISCOUNT_V1,
        TEMPLATE_IDS.DISCOUNT,
        1,
        'PUBLISHED',
        DISCOUNT_WORKFLOW,
        FORM_VERSION_IDS.DISCOUNT_V1,
        '2026-05-02T06:00:00.000Z',
        'member-301',
        null,
      ),
      templateVersionRow(
        TEMPLATE_VERSION_IDS.PURCHASE_DRAFT,
        TEMPLATE_IDS.PURCHASE,
        1,
        'DRAFT',
        PURCHASE_WORKFLOW,
        FORM_VERSION_IDS.PURCHASE_DRAFT,
        null,
        null,
        null,
      ),
    ],
  );

  await updateCurrentVersion(
    queryRunner,
    'approval_templates',
    TEMPLATE_IDS.EXPENSE,
    TEMPLATE_VERSION_IDS.EXPENSE_V1,
  );
  await updateCurrentVersion(
    queryRunner,
    'approval_templates',
    TEMPLATE_IDS.LEAVE,
    TEMPLATE_VERSION_IDS.LEAVE_V1,
  );
  await updateCurrentVersion(
    queryRunner,
    'approval_templates',
    TEMPLATE_IDS.ACCESS,
    TEMPLATE_VERSION_IDS.ACCESS_V1,
  );
  await updateCurrentVersion(
    queryRunner,
    'approval_templates',
    TEMPLATE_IDS.DISCOUNT,
    TEMPLATE_VERSION_IDS.DISCOUNT_V1,
  );
  await updateCurrentVersion(
    queryRunner,
    'approval_templates',
    TEMPLATE_IDS.PURCHASE,
    TEMPLATE_VERSION_IDS.PURCHASE_DRAFT,
  );
}

async function seedRuntimeData(queryRunner: QueryRunner): Promise<void> {
  await seedInstances(queryRunner);
  await seedTokens(queryRunner);
  await seedTasks(queryRunner);
  await seedSignatures(queryRunner);
  await seedTaskDecisions(queryRunner);
  await seedActivityLogs(queryRunner);
  await seedAttachments(queryRunner);
  await seedNotifications(queryRunner);
  await seedDelegations(queryRunner);
}

async function seedInstances(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'approval_instances',
    [
      'id',
      'template_id',
      'template_version_id',
      'initiator_member_id',
      'initiator_metadata_snapshot',
      'workflow_snapshot',
      'form_definition_snapshot',
      'form_data',
      'state',
      'title',
      'started_at',
      'completed_at',
      'created_at',
      'updated_at',
    ],
    [
      instanceRow(
        INSTANCE_IDS.EXPENSE_RUNNING,
        TEMPLATE_IDS.EXPENSE,
        TEMPLATE_VERSION_IDS.EXPENSE_V1,
        'member-102',
        EXPENSE_WORKFLOW,
        EXPENSE_FORM_SCHEMA,
        EXPENSE_FORM_UI_SCHEMA,
        {
          amount: 126800,
          invoiceDate: '2026-05-08',
          paymentType: 'software',
          reason: 'CRM 年度授權續約，合約已由業務與法務確認。',
          vendorName: 'Cloud CRM Taiwan',
        },
        'RUNNING',
        '費用請款：Cloud CRM 年費',
        '2026-05-10T01:10:00.000Z',
        null,
      ),
      instanceRow(
        INSTANCE_IDS.PURCHASE_RUNNING,
        TEMPLATE_IDS.EXPENSE,
        TEMPLATE_VERSION_IDS.EXPENSE_V1,
        'member-502',
        EXPENSE_WORKFLOW,
        EXPENSE_FORM_SCHEMA,
        EXPENSE_FORM_UI_SCHEMA,
        {
          amount: 382000,
          invoiceDate: '2026-05-09',
          paymentType: 'vendor',
          reason: '產品研究訪談與原型測試專案費用。',
          vendorName: 'Insight Research Lab',
        },
        'RUNNING',
        '費用請款：產品研究專案',
        '2026-05-09T02:30:00.000Z',
        null,
      ),
      instanceRow(
        INSTANCE_IDS.EXPENSE_APPROVED,
        TEMPLATE_IDS.EXPENSE,
        TEMPLATE_VERSION_IDS.EXPENSE_V1,
        'member-103',
        EXPENSE_WORKFLOW,
        EXPENSE_FORM_SCHEMA,
        EXPENSE_FORM_UI_SCHEMA,
        {
          amount: 48500,
          invoiceDate: '2026-05-03',
          paymentType: 'travel',
          reason: '客戶導入工作坊交通與住宿費。',
          vendorName: '高鐵與商務旅館',
        },
        'APPROVED',
        '費用請款：客戶導入差旅',
        '2026-05-03T02:00:00.000Z',
        '2026-05-05T07:20:00.000Z',
      ),
      instanceRow(
        INSTANCE_IDS.DISCOUNT_REJECTED,
        TEMPLATE_IDS.DISCOUNT,
        TEMPLATE_VERSION_IDS.DISCOUNT_V1,
        'member-302',
        DISCOUNT_WORKFLOW,
        DISCOUNT_FORM_SCHEMA,
        DISCOUNT_FORM_UI_SCHEMA,
        {
          contractAmount: 1800000,
          customerName: '北城零售股份有限公司',
          discountRate: 28,
          reason: '競品壓價，希望以年度合約折扣換取提前續約。',
        },
        'REJECTED',
        '客戶折扣：北城零售 28%',
        '2026-05-06T03:40:00.000Z',
        '2026-05-06T09:15:00.000Z',
      ),
      instanceRow(
        INSTANCE_IDS.ACCESS_RETURNED,
        TEMPLATE_IDS.ACCESS,
        TEMPLATE_VERSION_IDS.ACCESS_V1,
        'member-303',
        ACCESS_WORKFLOW,
        ACCESS_FORM_SCHEMA,
        ACCESS_FORM_UI_SCHEMA,
        {
          businessReason: '需要讀取客戶健康分數資料以完成續約風險盤點。',
          permissionLevel: 'write',
          systemName: 'warehouse',
        },
        'RETURNED',
        '系統權限：資料倉儲編輯權限',
        '2026-05-07T04:00:00.000Z',
        null,
      ),
      instanceRow(
        INSTANCE_IDS.LEAVE_APPROVED,
        TEMPLATE_IDS.LEAVE,
        TEMPLATE_VERSION_IDS.LEAVE_V1,
        'member-202',
        LEAVE_WORKFLOW,
        LEAVE_FORM_SCHEMA,
        LEAVE_FORM_UI_SCHEMA,
        {
          endDate: '2026-05-17',
          handoverNote: '新人到職文件由黃主管代為確認。',
          leaveType: 'annual',
          startDate: '2026-05-16',
        },
        'APPROVED',
        '請假申請：蔡人資專員特休',
        '2026-05-08T01:20:00.000Z',
        '2026-05-08T06:40:00.000Z',
      ),
      instanceRow(
        INSTANCE_IDS.PURCHASE_CANCELLED,
        TEMPLATE_IDS.EXPENSE,
        TEMPLATE_VERSION_IDS.EXPENSE_V1,
        'member-402',
        EXPENSE_WORKFLOW,
        EXPENSE_FORM_SCHEMA,
        EXPENSE_FORM_UI_SCHEMA,
        {
          amount: 92000,
          invoiceDate: '2026-05-02',
          paymentType: 'vendor',
          reason: '測試環境監控服務，後續改由既有供應商支援。',
          vendorName: 'Observability Pro',
        },
        'CANCELLED',
        '費用請款：監控服務 POC',
        '2026-05-02T02:45:00.000Z',
        '2026-05-02T04:10:00.000Z',
      ),
    ],
  );
}

async function seedTokens(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'workflow_tokens',
    [
      'id',
      'instance_id',
      'current_node_id',
      'status',
      'parent_token_id',
      'created_at',
      'consumed_at',
    ],
    [
      tokenRow(
        TOKEN_IDS.EXPENSE_RUNNING_FINANCE,
        INSTANCE_IDS.EXPENSE_RUNNING,
        'finance_review',
        'ACTIVE',
        '2026-05-10T01:10:00.000Z',
        null,
      ),
      tokenRow(
        TOKEN_IDS.PURCHASE_RUNNING_CEO,
        INSTANCE_IDS.PURCHASE_RUNNING,
        'finance_review',
        'ACTIVE',
        '2026-05-09T02:30:00.000Z',
        null,
      ),
      tokenRow(
        TOKEN_IDS.EXPENSE_APPROVED,
        INSTANCE_IDS.EXPENSE_APPROVED,
        'end',
        'CONSUMED',
        '2026-05-03T02:00:00.000Z',
        '2026-05-05T07:20:00.000Z',
      ),
      tokenRow(
        TOKEN_IDS.DISCOUNT_REJECTED,
        INSTANCE_IDS.DISCOUNT_REJECTED,
        'end',
        'CONSUMED',
        '2026-05-06T03:40:00.000Z',
        '2026-05-06T09:15:00.000Z',
      ),
      tokenRow(
        TOKEN_IDS.ACCESS_RETURNED,
        INSTANCE_IDS.ACCESS_RETURNED,
        'manager_review',
        'WAITING',
        '2026-05-07T04:00:00.000Z',
        null,
      ),
      tokenRow(
        TOKEN_IDS.LEAVE_APPROVED,
        INSTANCE_IDS.LEAVE_APPROVED,
        'end',
        'CONSUMED',
        '2026-05-08T01:20:00.000Z',
        '2026-05-08T06:40:00.000Z',
      ),
      tokenRow(
        TOKEN_IDS.PURCHASE_CANCELLED,
        INSTANCE_IDS.PURCHASE_CANCELLED,
        'manager_review',
        'CONSUMED',
        '2026-05-02T02:45:00.000Z',
        '2026-05-02T04:10:00.000Z',
      ),
    ],
  );
}

async function seedTasks(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'tasks',
    [
      'id',
      'instance_id',
      'token_id',
      'node_id',
      'original_assignee_member_id',
      'assignee_member_id',
      'delegation_chain',
      'status',
      'sla_due_at',
      'created_at',
      'opened_at',
      'completed_at',
    ],
    [
      taskRow(
        TASK_IDS.EXPENSE_RUNNING_MANAGER,
        INSTANCE_IDS.EXPENSE_RUNNING,
        TOKEN_IDS.EXPENSE_RUNNING_FINANCE,
        'manager_review',
        'member-101',
        'member-101',
        'COMPLETED',
        '2026-05-12T02:00:00.000Z',
        '2026-05-10T01:12:00.000Z',
        '2026-05-10T01:30:00.000Z',
        '2026-05-10T02:15:00.000Z',
      ),
      taskRow(
        TASK_IDS.EXPENSE_RUNNING_FINANCE,
        INSTANCE_IDS.EXPENSE_RUNNING,
        TOKEN_IDS.EXPENSE_RUNNING_FINANCE,
        'finance_review',
        'member-101',
        'member-101',
        'PENDING',
        '2026-05-14T09:00:00.000Z',
        '2026-05-10T02:15:00.000Z',
        null,
        null,
      ),
      taskRow(
        TASK_IDS.PURCHASE_RUNNING_CEO,
        INSTANCE_IDS.PURCHASE_RUNNING,
        TOKEN_IDS.PURCHASE_RUNNING_CEO,
        'finance_review',
        'member-001',
        'member-001',
        'PENDING',
        '2026-05-10T09:00:00.000Z',
        '2026-05-09T03:00:00.000Z',
        null,
        null,
      ),
      taskRow(
        TASK_IDS.EXPENSE_APPROVED_MANAGER,
        INSTANCE_IDS.EXPENSE_APPROVED,
        TOKEN_IDS.EXPENSE_APPROVED,
        'manager_review',
        'member-101',
        'member-101',
        'COMPLETED',
        '2026-05-04T02:00:00.000Z',
        '2026-05-03T02:10:00.000Z',
        '2026-05-03T03:00:00.000Z',
        '2026-05-03T04:00:00.000Z',
      ),
      taskRow(
        TASK_IDS.EXPENSE_APPROVED_FINANCE,
        INSTANCE_IDS.EXPENSE_APPROVED,
        TOKEN_IDS.EXPENSE_APPROVED,
        'finance_review',
        'member-101',
        'member-101',
        'COMPLETED',
        '2026-05-05T02:00:00.000Z',
        '2026-05-03T04:05:00.000Z',
        '2026-05-05T06:30:00.000Z',
        '2026-05-05T07:20:00.000Z',
      ),
      taskRow(
        TASK_IDS.DISCOUNT_REJECTED_MANAGER,
        INSTANCE_IDS.DISCOUNT_REJECTED,
        TOKEN_IDS.DISCOUNT_REJECTED,
        'sales_manager_review',
        'member-301',
        'member-301',
        'COMPLETED',
        '2026-05-07T03:40:00.000Z',
        '2026-05-06T03:45:00.000Z',
        '2026-05-06T08:50:00.000Z',
        '2026-05-06T09:15:00.000Z',
      ),
      taskRow(
        TASK_IDS.ACCESS_RETURNED_IT,
        INSTANCE_IDS.ACCESS_RETURNED,
        TOKEN_IDS.ACCESS_RETURNED,
        'it_security_review',
        'member-401',
        'member-401',
        'COMPLETED',
        '2026-05-08T04:00:00.000Z',
        '2026-05-07T05:10:00.000Z',
        '2026-05-07T06:40:00.000Z',
        '2026-05-07T07:05:00.000Z',
      ),
      taskRow(
        TASK_IDS.LEAVE_APPROVED_MANAGER,
        INSTANCE_IDS.LEAVE_APPROVED,
        TOKEN_IDS.LEAVE_APPROVED,
        'manager_review',
        'member-201',
        'member-201',
        'COMPLETED',
        '2026-05-09T01:20:00.000Z',
        '2026-05-08T01:25:00.000Z',
        '2026-05-08T03:00:00.000Z',
        '2026-05-08T06:40:00.000Z',
      ),
      taskRow(
        TASK_IDS.PURCHASE_CANCELLED_MANAGER,
        INSTANCE_IDS.PURCHASE_CANCELLED,
        TOKEN_IDS.PURCHASE_CANCELLED,
        'manager_review',
        'member-401',
        'member-401',
        'CANCELLED',
        '2026-05-03T02:45:00.000Z',
        '2026-05-02T02:50:00.000Z',
        null,
        '2026-05-02T04:10:00.000Z',
      ),
    ],
  );
}

async function seedSignatures(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'signatures',
    [
      'id',
      'instance_id',
      'task_id',
      'signer_member_id',
      'algorithm',
      'signed_payload',
      'signed_payload_hash',
      'signature',
      'key_version',
      'previous_signature_hash',
      'timestamp_token',
      'signed_at',
    ],
    [
      signatureRow(
        '64000000-0000-4000-8000-000000000001',
        INSTANCE_IDS.EXPENSE_APPROVED,
        TASK_IDS.EXPENSE_APPROVED_MANAGER,
        'member-101',
        'approved-manager-expense',
        null,
        '2026-05-03T04:00:00.000Z',
      ),
      signatureRow(
        '64000000-0000-4000-8000-000000000002',
        INSTANCE_IDS.EXPENSE_APPROVED,
        TASK_IDS.EXPENSE_APPROVED_FINANCE,
        'member-101',
        'approved-finance-expense',
        'approved-manager-expense-hash',
        '2026-05-05T07:20:00.000Z',
      ),
      signatureRow(
        '64000000-0000-4000-8000-000000000003',
        INSTANCE_IDS.DISCOUNT_REJECTED,
        TASK_IDS.DISCOUNT_REJECTED_MANAGER,
        'member-301',
        'rejected-discount',
        null,
        '2026-05-06T09:15:00.000Z',
      ),
      signatureRow(
        '64000000-0000-4000-8000-000000000004',
        INSTANCE_IDS.ACCESS_RETURNED,
        TASK_IDS.ACCESS_RETURNED_IT,
        'member-401',
        'returned-access',
        null,
        '2026-05-07T07:05:00.000Z',
      ),
      signatureRow(
        '64000000-0000-4000-8000-000000000005',
        INSTANCE_IDS.LEAVE_APPROVED,
        TASK_IDS.LEAVE_APPROVED_MANAGER,
        'member-201',
        'approved-leave',
        null,
        '2026-05-08T06:40:00.000Z',
      ),
    ],
  );
}

async function seedTaskDecisions(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'task_decisions',
    [
      'id',
      'task_id',
      'decided_by_member_id',
      'action',
      'comment',
      'return_to_node_id',
      'transfer_to_member_id',
      'signature_id',
      'decided_at',
    ],
    [
      decisionRow(
        '63000000-0000-4000-8000-000000000001',
        TASK_IDS.EXPENSE_RUNNING_MANAGER,
        'member-101',
        'APPROVED',
        '金額與供應商資訊確認無誤，交由財務覆核。',
        null,
        null,
        null,
        '2026-05-10T02:15:00.000Z',
      ),
      decisionRow(
        '63000000-0000-4000-8000-000000000002',
        TASK_IDS.EXPENSE_APPROVED_MANAGER,
        'member-101',
        'APPROVED',
        '差旅與客戶導入行程相符。',
        null,
        null,
        '64000000-0000-4000-8000-000000000001',
        '2026-05-03T04:00:00.000Z',
      ),
      decisionRow(
        '63000000-0000-4000-8000-000000000003',
        TASK_IDS.EXPENSE_APPROVED_FINANCE,
        'member-101',
        'APPROVED',
        '憑證完整，排入付款批次。',
        null,
        null,
        '64000000-0000-4000-8000-000000000002',
        '2026-05-05T07:20:00.000Z',
      ),
      decisionRow(
        '63000000-0000-4000-8000-000000000004',
        TASK_IDS.DISCOUNT_REJECTED_MANAGER,
        'member-301',
        'REJECTED',
        '折扣幅度過高，缺少競品報價與毛利分析。',
        null,
        null,
        '64000000-0000-4000-8000-000000000003',
        '2026-05-06T09:15:00.000Z',
      ),
      decisionRow(
        '63000000-0000-4000-8000-000000000005',
        TASK_IDS.ACCESS_RETURNED_IT,
        'member-401',
        'RETURNED',
        '請改申請唯讀權限，並補上資料使用期限。',
        'manager_review',
        null,
        '64000000-0000-4000-8000-000000000004',
        '2026-05-07T07:05:00.000Z',
      ),
      decisionRow(
        '63000000-0000-4000-8000-000000000006',
        TASK_IDS.LEAVE_APPROVED_MANAGER,
        'member-201',
        'APPROVED',
        '交接事項完整。',
        null,
        null,
        '64000000-0000-4000-8000-000000000005',
        '2026-05-08T06:40:00.000Z',
      ),
    ],
  );
}

async function seedActivityLogs(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'activity_logs',
    [
      'instance_id',
      'event_type',
      'actor_member_id',
      'node_id',
      'task_id',
      'payload',
      'created_at',
    ],
    [
      activityRow(
        INSTANCE_IDS.EXPENSE_RUNNING,
        'INSTANCE_STARTED',
        'member-102',
        'start',
        null,
        { title: '費用請款：Cloud CRM 年費' },
        '2026-05-10T01:10:00.000Z',
      ),
      activityRow(
        INSTANCE_IDS.EXPENSE_RUNNING,
        'TASK_CREATED',
        null,
        'manager_review',
        TASK_IDS.EXPENSE_RUNNING_MANAGER,
        { assigneeMemberId: 'member-101' },
        '2026-05-10T01:12:00.000Z',
      ),
      activityRow(
        INSTANCE_IDS.EXPENSE_RUNNING,
        'TASK_DECIDED',
        'member-101',
        'manager_review',
        TASK_IDS.EXPENSE_RUNNING_MANAGER,
        {
          action: 'APPROVED',
          comment: '金額與供應商資訊確認無誤，交由財務覆核。',
        },
        '2026-05-10T02:15:00.000Z',
      ),
      activityRow(
        INSTANCE_IDS.EXPENSE_RUNNING,
        'TASK_CREATED',
        null,
        'finance_review',
        TASK_IDS.EXPENSE_RUNNING_FINANCE,
        { assigneeMemberId: 'member-101' },
        '2026-05-10T02:15:10.000Z',
      ),
      activityRow(
        INSTANCE_IDS.PURCHASE_RUNNING,
        'SLA_TRIGGERED',
        null,
        'finance_review',
        TASK_IDS.PURCHASE_RUNNING_CEO,
        { dueAt: '2026-05-10T09:00:00.000Z', type: 'SLA_OVERDUE' },
        '2026-05-11T09:05:00.000Z',
      ),
      activityRow(
        INSTANCE_IDS.DISCOUNT_REJECTED,
        'TASK_DECIDED',
        'member-301',
        'sales_manager_review',
        TASK_IDS.DISCOUNT_REJECTED_MANAGER,
        {
          action: 'REJECTED',
          comment: '折扣幅度過高，缺少競品報價與毛利分析。',
        },
        '2026-05-06T09:15:00.000Z',
      ),
      activityRow(
        INSTANCE_IDS.ACCESS_RETURNED,
        'INSTANCE_RETURNED',
        'member-401',
        'it_security_review',
        TASK_IDS.ACCESS_RETURNED_IT,
        { returnToNodeId: 'manager_review' },
        '2026-05-07T07:05:00.000Z',
      ),
      activityRow(
        INSTANCE_IDS.LEAVE_APPROVED,
        'TASK_DECIDED',
        'member-201',
        'manager_review',
        TASK_IDS.LEAVE_APPROVED_MANAGER,
        { action: 'APPROVED' },
        '2026-05-08T06:40:00.000Z',
      ),
      activityRow(
        INSTANCE_IDS.PURCHASE_CANCELLED,
        'INSTANCE_CANCELLED',
        'member-402',
        'manager_review',
        TASK_IDS.PURCHASE_CANCELLED_MANAGER,
        { reason: '供應商整併，取消 POC 費用。' },
        '2026-05-02T04:10:00.000Z',
      ),
    ],
  );
}

async function seedAttachments(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'attachments',
    [
      'id',
      'instance_id',
      'task_id',
      'form_field_path',
      'uploader_member_id',
      'filename',
      'mime_type',
      'size_bytes',
      'storage_provider',
      'storage_key',
      'encryption_key_id',
      'checksum_sha256',
      'created_at',
    ],
    [
      attachmentRow(
        '65000000-0000-4000-8000-000000000001',
        INSTANCE_IDS.EXPENSE_RUNNING,
        null,
        'receipt',
        'member-102',
        'cloud-crm-invoice.pdf',
        184920,
        '2026-05-10T01:09:00.000Z',
      ),
      attachmentRow(
        '65000000-0000-4000-8000-000000000002',
        INSTANCE_IDS.EXPENSE_APPROVED,
        null,
        'receipt',
        'member-103',
        'travel-receipts.zip',
        392012,
        '2026-05-03T01:58:00.000Z',
      ),
    ],
  );
}

async function seedNotifications(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'notification_preferences',
    [
      'member_id',
      'in_app_enabled',
      'email_enabled',
      'email_digest_mode',
      'quiet_hours_start',
      'quiet_hours_end',
      'updated_at',
    ],
    [
      notificationPreferenceRow('member-001', 'DAILY', '19:00:00', '08:30:00'),
      notificationPreferenceRow(
        'member-101',
        'INSTANT',
        '20:00:00',
        '08:00:00',
      ),
      notificationPreferenceRow('member-201', 'INSTANT', null, null),
      notificationPreferenceRow('member-301', 'DAILY', '19:30:00', '08:30:00'),
      notificationPreferenceRow('member-401', 'INSTANT', null, null),
    ],
  );

  await insertRows(
    queryRunner,
    'notifications',
    [
      'id',
      'recipient_member_id',
      'channel',
      'type',
      'instance_id',
      'task_id',
      'title',
      'body',
      'payload',
      'status',
      'sent_at',
      'read_at',
      'created_at',
    ],
    [
      notificationRow(
        '70000000-0000-4000-8000-000000000001',
        'member-101',
        'TASK_ASSIGNED',
        INSTANCE_IDS.EXPENSE_RUNNING,
        TASK_IDS.EXPENSE_RUNNING_FINANCE,
        '待簽核：費用請款',
        'Cloud CRM 年費已通過主管簽核，等待財務覆核。',
        'SENT',
        '2026-05-10T02:15:20.000Z',
        null,
      ),
      notificationRow(
        '70000000-0000-4000-8000-000000000002',
        'member-001',
        'SLA_OVERDUE',
        INSTANCE_IDS.PURCHASE_RUNNING,
        TASK_IDS.PURCHASE_RUNNING_CEO,
        'SLA 已逾期：產品研究專案',
        '此請款已超過預算核准 SLA，請優先處理。',
        'SENT',
        '2026-05-11T09:05:00.000Z',
        null,
      ),
      notificationRow(
        '70000000-0000-4000-8000-000000000003',
        'member-103',
        'INSTANCE_COMPLETED',
        INSTANCE_IDS.EXPENSE_APPROVED,
        TASK_IDS.EXPENSE_APPROVED_FINANCE,
        '案件已核准',
        '客戶導入差旅費用已完成簽核。',
        'READ',
        '2026-05-05T07:20:30.000Z',
        '2026-05-05T08:10:00.000Z',
      ),
      notificationRow(
        '70000000-0000-4000-8000-000000000004',
        'member-302',
        'INSTANCE_COMPLETED',
        INSTANCE_IDS.DISCOUNT_REJECTED,
        TASK_IDS.DISCOUNT_REJECTED_MANAGER,
        '折扣申請已拒絕',
        '北城零售 28% 折扣申請已被退件。',
        'READ',
        '2026-05-06T09:15:30.000Z',
        '2026-05-06T09:20:00.000Z',
      ),
      notificationRow(
        '70000000-0000-4000-8000-000000000005',
        'member-303',
        'INSTANCE_COMPLETED',
        INSTANCE_IDS.ACCESS_RETURNED,
        TASK_IDS.ACCESS_RETURNED_IT,
        '權限申請已退回',
        '請調整權限等級並補上資料使用期限。',
        'SENT',
        '2026-05-07T07:05:30.000Z',
        null,
      ),
    ],
  );
}

async function seedDelegations(queryRunner: QueryRunner): Promise<void> {
  await insertRows(
    queryRunner,
    'delegation_rules',
    [
      'id',
      'principal_member_id',
      'agent_member_id',
      'scope_type',
      'scope_template_ids',
      'scope_condition_cel',
      'priority',
      'start_at',
      'end_at',
      'requires_confirmation',
      'status',
      'created_by_member_id',
      'created_at',
      'updated_at',
      'revoked_at',
      'revoked_by_member_id',
    ],
    [
      delegationRow(
        '80000000-0000-4000-8000-000000000001',
        'member-101',
        'member-103',
        'TEMPLATE_LIST',
        [TEMPLATE_IDS.EXPENSE],
        null,
        120,
        '2026-05-12T00:00:00.000Z',
        '2026-05-20T23:59:59.000Z',
        false,
        'ACTIVE',
        'member-101',
        null,
        null,
      ),
      delegationRow(
        '80000000-0000-4000-8000-000000000002',
        'member-401',
        'member-402',
        'CONDITION_BASED',
        [],
        'form.systemName == "cloud-console"',
        90,
        '2026-05-01T00:00:00.000Z',
        null,
        true,
        'ACTIVE',
        'member-401',
        null,
        null,
      ),
      delegationRow(
        '80000000-0000-4000-8000-000000000003',
        'member-301',
        'member-303',
        'ALL',
        [],
        null,
        50,
        '2026-04-01T00:00:00.000Z',
        '2026-04-30T23:59:59.000Z',
        false,
        'EXPIRED',
        'member-301',
        null,
        null,
      ),
      delegationRow(
        '80000000-0000-4000-8000-000000000004',
        'member-201',
        'member-202',
        'ALL',
        [],
        null,
        80,
        '2026-05-01T00:00:00.000Z',
        '2026-05-31T23:59:59.000Z',
        false,
        'REVOKED',
        'member-201',
        '2026-05-09T02:00:00.000Z',
        'member-201',
      ),
    ],
  );
}

function createWorkflowDefinition({
  approvalNodes,
}: {
  readonly approvalNodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly resolver: Readonly<Record<string, unknown>>;
    readonly x: number;
    readonly y: number;
  }[];
}): Readonly<Record<string, unknown>> {
  const nodes = [
    {
      data: { label: '開始' },
      id: 'start',
      position: { x: 0, y: 0 },
      type: 'startEvent',
    },
    ...approvalNodes.map((node) => ({
      data: {
        allowAddSigner: false,
        allowReject: true,
        allowTransfer: true,
        approverResolver: node.resolver,
        decisionPolicy: { type: 'SINGLE' },
        label: node.label,
        returnBehavior: {
          allowReturn: true,
          allowedTargets: 'PREVIOUS',
          resubmitStrategy: 'FROM_RETURN_POINT',
        },
        sla: {
          duration: 'P2D',
          onTimeout: 'REMIND',
          warningAt: 75,
        },
      },
      id: node.id,
      position: { x: node.x, y: node.y },
      type: 'userTask',
    })),
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 220 + approvalNodes.length * 240, y: 0 },
      type: 'endEvent',
    },
  ];
  const edgeNodes = ['start', ...approvalNodes.map((node) => node.id), 'end'];
  const edges = edgeNodes.slice(0, -1).map((source, index) => ({
    data: {},
    id: `edge-${source}-${edgeNodes[index + 1]}`,
    source,
    target: edgeNodes[index + 1],
    type: 'smoothstep',
  }));

  return {
    edges,
    meta: { diagramVersion: 'demo-seed-2026-05-13', schemaVersion: 1 },
    nodes,
  };
}

function formDefinitionRow(
  id: string,
  name: string,
  description: string,
  createdByMemberId: string,
): SeedRow {
  return {
    created_at: text(NOW),
    created_by_member_id: text(createdByMemberId),
    current_version_id: text(null),
    description: text(description),
    id: text(id),
    name: text(name),
    updated_at: text(NOW),
  };
}

function formVersionRow(
  id: string,
  formDefinitionId: string,
  version: number,
  status: string,
  schema: unknown,
  uiSchema: unknown,
  publishedAt: string | null,
  publishedByMemberId: string | null,
  archivedAt: string | null,
): SeedRow {
  return {
    archived_at: text(archivedAt),
    created_at: text(NOW),
    form_definition_id: text(formDefinitionId),
    id: text(id),
    published_at: text(publishedAt),
    published_by_member_id: text(publishedByMemberId),
    schema: jsonb(schema),
    status: text(status),
    ui_schema: jsonb(uiSchema),
    updated_at: text(NOW),
    version: numberCell(version),
  };
}

function templateRow(
  id: string,
  name: string,
  description: string,
  category: string,
  categoryId: string,
  createdByMemberId: string,
): SeedRow {
  return {
    category: text(category),
    category_id: text(categoryId),
    created_at: text(NOW),
    created_by_member_id: text(createdByMemberId),
    current_version_id: text(null),
    description: text(description),
    id: text(id),
    name: text(name),
    updated_at: text(NOW),
  };
}

function templateVersionRow(
  id: string,
  templateId: string,
  version: number,
  status: string,
  workflowDefinition: unknown,
  formDefinitionVersionId: string,
  publishedAt: string | null,
  publishedByMemberId: string | null,
  archivedAt: string | null,
): SeedRow {
  return {
    archived_at: text(archivedAt),
    created_at: text(NOW),
    form_definition_version_id: text(formDefinitionVersionId),
    id: text(id),
    initiator_policy_cel: text(null),
    notification_config: jsonb({
      channels: ['IN_APP'],
      taskAssigned: true,
    }),
    published_at: text(publishedAt),
    published_by_member_id: text(publishedByMemberId),
    sla_defaults: jsonb({ duration: 'P2D', warningAt: 75 }),
    status: text(status),
    template_id: text(templateId),
    updated_at: text(NOW),
    version: numberCell(version),
    workflow_definition: jsonb(workflowDefinition),
  };
}

function instanceRow(
  id: string,
  templateId: string,
  templateVersionId: string,
  initiatorMemberId: string,
  workflowSnapshot: unknown,
  formSchema: unknown,
  formUiSchema: unknown,
  formData: unknown,
  state: string,
  title: string,
  startedAt: string,
  completedAt: string | null,
): SeedRow {
  return {
    completed_at: text(completedAt),
    created_at: text(startedAt),
    form_data: jsonb(formData),
    form_definition_snapshot: jsonb({
      schema: formSchema,
      uiSchema: formUiSchema,
    }),
    id: text(id),
    initiator_member_id: text(initiatorMemberId),
    initiator_metadata_snapshot: jsonb(readMemberMetadata(initiatorMemberId)),
    started_at: text(startedAt),
    state: text(state),
    template_id: text(templateId),
    template_version_id: text(templateVersionId),
    title: text(title),
    updated_at: text(completedAt ?? NOW),
    workflow_snapshot: jsonb(workflowSnapshot),
  };
}

function tokenRow(
  id: string,
  instanceId: string,
  currentNodeId: string,
  status: string,
  createdAt: string,
  consumedAt: string | null,
): SeedRow {
  return {
    consumed_at: text(consumedAt),
    created_at: text(createdAt),
    current_node_id: text(currentNodeId),
    id: text(id),
    instance_id: text(instanceId),
    parent_token_id: text(null),
    status: text(status),
  };
}

function taskRow(
  id: string,
  instanceId: string,
  tokenId: string,
  nodeId: string,
  originalAssigneeMemberId: string,
  assigneeMemberId: string,
  status: string,
  slaDueAt: string,
  createdAt: string,
  openedAt: string | null,
  completedAt: string | null,
): SeedRow {
  return {
    assignee_member_id: text(assigneeMemberId),
    completed_at: text(completedAt),
    created_at: text(createdAt),
    delegation_chain: jsonb([]),
    id: text(id),
    instance_id: text(instanceId),
    node_id: text(nodeId),
    opened_at: text(openedAt),
    original_assignee_member_id: text(originalAssigneeMemberId),
    sla_due_at: text(slaDueAt),
    status: text(status),
    token_id: text(tokenId),
  };
}

function signatureRow(
  id: string,
  instanceId: string,
  taskId: string,
  signerMemberId: string,
  hashPrefix: string,
  previousSignatureHash: string | null,
  signedAt: string,
): SeedRow {
  return {
    algorithm: text('HMAC-SHA256'),
    id: text(id),
    instance_id: text(instanceId),
    key_version: numberCell(1),
    previous_signature_hash: text(previousSignatureHash),
    signature: text(`${hashPrefix}-signature`),
    signed_at: text(signedAt),
    signed_payload: jsonb({ actionAt: signedAt, signerMemberId, taskId }),
    signed_payload_hash: text(`${hashPrefix}-hash`),
    signer_member_id: text(signerMemberId),
    task_id: text(taskId),
    timestamp_token: text(null),
  };
}

function decisionRow(
  id: string,
  taskId: string,
  decidedByMemberId: string,
  action: string,
  comment: string | null,
  returnToNodeId: string | null,
  transferToMemberId: string | null,
  signatureId: string | null,
  decidedAt: string,
): SeedRow {
  return {
    action: text(action),
    comment: text(comment),
    decided_at: text(decidedAt),
    decided_by_member_id: text(decidedByMemberId),
    id: text(id),
    return_to_node_id: text(returnToNodeId),
    signature_id: text(signatureId),
    task_id: text(taskId),
    transfer_to_member_id: text(transferToMemberId),
  };
}

function activityRow(
  instanceId: string,
  eventType: string,
  actorMemberId: string | null,
  nodeId: string | null,
  taskId: string | null,
  payload: unknown,
  createdAt: string,
): SeedRow {
  return {
    actor_member_id: text(actorMemberId),
    created_at: text(createdAt),
    event_type: text(eventType),
    instance_id: text(instanceId),
    node_id: text(nodeId),
    payload: jsonb(payload),
    task_id: text(taskId),
  };
}

function attachmentRow(
  id: string,
  instanceId: string,
  taskId: string | null,
  formFieldPath: string,
  uploaderMemberId: string,
  filename: string,
  sizeBytes: number,
  createdAt: string,
): SeedRow {
  return {
    checksum_sha256: text(`${id.replace(/-/g, '')}checksum`),
    created_at: text(createdAt),
    encryption_key_id: text(null),
    filename: text(filename),
    form_field_path: text(formFieldPath),
    id: text(id),
    instance_id: text(instanceId),
    mime_type: text(
      filename.endsWith('.pdf') ? 'application/pdf' : 'application/zip',
    ),
    size_bytes: text(String(sizeBytes)),
    storage_key: text(`demo/${id}/${filename}`),
    storage_provider: text('local'),
    task_id: text(taskId),
    uploader_member_id: text(uploaderMemberId),
  };
}

function notificationPreferenceRow(
  memberId: string,
  digestMode: string,
  quietHoursStart: string | null,
  quietHoursEnd: string | null,
): SeedRow {
  return {
    email_digest_mode: text(digestMode),
    email_enabled: bool(true),
    in_app_enabled: bool(true),
    member_id: text(memberId),
    quiet_hours_end: text(quietHoursEnd),
    quiet_hours_start: text(quietHoursStart),
    updated_at: text(NOW),
  };
}

function notificationRow(
  id: string,
  recipientMemberId: string,
  typeValue: string,
  instanceId: string,
  taskId: string,
  title: string,
  body: string,
  status: string,
  sentAt: string,
  readAt: string | null,
): SeedRow {
  return {
    body: text(body),
    channel: text('IN_APP'),
    created_at: text(sentAt),
    id: text(id),
    instance_id: text(instanceId),
    payload: jsonb({ instanceId, taskId }),
    read_at: text(readAt),
    recipient_member_id: text(recipientMemberId),
    sent_at: text(sentAt),
    status: text(status),
    task_id: text(taskId),
    title: text(title),
    type: text(typeValue),
  };
}

function delegationRow(
  id: string,
  principalMemberId: string,
  agentMemberId: string,
  scopeType: string,
  scopeTemplateIds: readonly string[],
  scopeConditionCel: string | null,
  priority: number,
  startAt: string,
  endAt: string | null,
  requiresConfirmation: boolean,
  status: string,
  createdByMemberId: string,
  revokedAt: string | null,
  revokedByMemberId: string | null,
): SeedRow {
  return {
    agent_member_id: text(agentMemberId),
    created_at: text(NOW),
    created_by_member_id: text(createdByMemberId),
    end_at: text(endAt),
    id: text(id),
    principal_member_id: text(principalMemberId),
    priority: numberCell(priority),
    requires_confirmation: bool(requiresConfirmation),
    revoked_at: text(revokedAt),
    revoked_by_member_id: text(revokedByMemberId),
    scope_condition_cel: text(scopeConditionCel),
    scope_template_ids: uuidArray(scopeTemplateIds),
    scope_type: text(scopeType),
    start_at: text(startAt),
    status: text(status),
    updated_at: text(NOW),
  };
}

function categoryRow(
  id: string,
  name: string,
  description: string,
  sortOrder: number,
): SeedRow {
  return {
    created_at: text(NOW),
    description: text(description),
    id: text(id),
    is_active: bool(true),
    name: text(name),
    sort_order: numberCell(sortOrder),
    updated_at: text(NOW),
  };
}

function positionRow(
  id: string,
  code: string,
  name: string,
  level: number,
  approvalLimit: number | string,
): SeedRow {
  return {
    code: text(code),
    created_at: text(NOW),
    id: text(id),
    level: numberCell(level),
    metadata: jsonb({ approvalLimit }),
    name: text(name),
    updated_at: text(NOW),
  };
}

function managerResolution(
  scopeType: string,
  scopeId: string,
  managerMemberId: string,
  priority: number,
): SeedRow {
  return {
    created_at: text(NOW),
    effective_from: text(EFFECTIVE_FROM),
    effective_to: text(null),
    manager_member_id: text(managerMemberId),
    priority: numberCell(priority),
    scope_id: text(scopeId),
    scope_type: text(scopeType),
  };
}

async function updateCurrentVersion(
  queryRunner: QueryRunner,
  table: string,
  id: string,
  currentVersionId: string,
): Promise<void> {
  await queryRunner.query(
    `UPDATE ${quoteIdentifier(table)}
     SET current_version_id = $1,
         updated_at = $2
     WHERE id = $3`,
    [currentVersionId, NOW, id],
  );
}

async function insertRows(
  queryRunner: QueryRunner,
  table: string,
  columns: readonly string[],
  rows: readonly SeedRow[],
): Promise<void> {
  if (!rows.length) {
    return;
  }

  const columnCount = columns.length;
  const placeholders = rows
    .map((row, rowIndex): string => {
      const values = columns
        .map((column, columnIndex): string => {
          const parameterIndex = rowIndex * columnCount + columnIndex + 1;
          const cast = row[column].cast ? `::${row[column].cast}` : '';

          return `$${parameterIndex}${cast}`;
        })
        .join(', ');

      return `(${values})`;
    })
    .join(',\n');
  const parameters = rows.flatMap((row): SqlScalar[] =>
    columns.map((column): SqlScalar => row[column].value),
  );

  await queryRunner.query(
    `INSERT INTO ${quoteIdentifier(table)} (${columns
      .map(quoteIdentifier)
      .join(', ')})
     VALUES ${placeholders}`,
    parameters,
  );
}

function readMemberMetadata(
  memberId: string,
): Readonly<Record<string, unknown>> {
  const member = MEMBERS.find((candidate) => candidate.memberId === memberId);

  if (!member) {
    return {
      customFields: {},
      email: `${memberId}@example.internal`,
      memberId,
      name: memberId,
      positionId: null,
      primaryOrgUnitId: null,
    };
  }

  return {
    customFields: { employeeNo: member.memberId.replace('member-', 'EMP-') },
    email: member.email,
    memberId: member.memberId,
    name: member.name,
    positionId: member.positionCode,
    primaryOrgUnitId: member.orgUnitCode,
  };
}

function readRequiredValue(
  values: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = values[key];

  if (!value) {
    throw new Error(`Missing demo seed value for ${key}`);
  }

  return value;
}

function readSchema(options: DataSourceOptions): string {
  if ('schema' in options && typeof options.schema === 'string') {
    return options.schema;
  }

  throw new Error('DataSource options did not include a PostgreSQL schema');
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function text(value: string | null): SqlCell {
  return { value };
}

function numberCell(value: number): SqlCell {
  return { value };
}

function bool(value: boolean): SqlCell {
  return { value };
}

function jsonb(value: unknown): SqlCell {
  return { cast: 'jsonb', value: JSON.stringify(value) };
}

function ltree(value: string): SqlCell {
  return { cast: 'ltree', value };
}

function uuidArray(value: readonly string[]): SqlCell {
  return { cast: 'uuid[]', value };
}

void main()
  .then((): void => {
    console.log('Demo develop database was reset and seeded.');
  })
  .catch((error: unknown): void => {
    console.error(error);
    process.exitCode = 1;
  });
