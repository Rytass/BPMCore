/**
 * The expressions the two dialects are compared on (Phase 23 P1 gate: every
 * expression shape that exists in the repo). Each entry names where the shape
 * comes from. `expected` pins what each dialect really does today, so a change
 * in either engine, or in the runtime, fails the real-engine suite instead of
 * silently changing what a dialect upgrade means. Every difference is listed
 * and judged in docs/23 §P1.
 *
 * Sources:
 * - SEED: apps/api/tools/reset-demo-data.ts
 * - DOCS: docs/05, docs/22, docs/24 examples
 * - DESIGNER: expressions the UI writes (form-rendering.ts `form.<key> op
 *   literal`, workflow-graph.ts `readConditionExpression`,
 *   TemplateDesignerView initiator policy)
 * - FIXTURE: expressions used by the backend and frontend test suites
 * - PROBE: edge cases added to cover the documented differences
 */

export type DifferentialSource =
  'DESIGNER' | 'DOCS' | 'FIXTURE' | 'PROBE' | 'SEED';

export interface DifferentialCorpusEntry {
  readonly id: string;
  readonly source: DifferentialSource;
  readonly expression: string;
  /** Merged over the base `form` for this entry only. */
  readonly form?: Readonly<Record<string, unknown>>;
  readonly lastDecision?: Readonly<Record<string, unknown>> | null;
  readonly expected: {
    readonly legacy: string;
    readonly v2: string;
  };
}

const MEMBER_CONTEXT = {
  memberId: 'member-101',
  org: { code: 'FIN' },
  orgUnitIds: ['unit-1', 'org-finance'],
  positionIds: ['position-department-head'],
  roles: ['manager', 'admin'],
};

export const DIFFERENTIAL_BASE_FORM: Readonly<Record<string, unknown>> = {
  'a-b': ['x"y'],
  amount: 1_500_000,
  approvalLevel: 2,
  audit: { level: 2 },
  email: 'a@example.com',
  empty: '',
  flag: true,
  invoiceKind: 'B2B',
  invoiceKindNote: 'x',
  items: [
    { name: 'Bolt', qty: 3 },
    { name: 'Nut', qty: 1 },
  ],
  kind: 'general',
  multi: ['A', 'B'],
  note: 'audit',
  nothing: null,
  owner: 'member-201',
  price: 2.5,
  priority: 'urgent',
  qty: 3,
  region: 'TW',
  reviewer: [],
  sec: 'x',
  status: 'account',
  systemName: 'cloud-console',
  tags: ['a', 'b', 'urgent'],
  zero: 0,
  稅額: 10,
};

/** The full context of one entry: every root any use point can read. */
export const readDifferentialContext = (
  entry: DifferentialCorpusEntry,
): Readonly<Record<string, unknown>> => {
  const form = { ...DIFFERENTIAL_BASE_FORM, ...entry.form };

  return {
    env: { now: '2026-11-07T00:00:00.000Z' },
    form,
    formData: form,
    initiator: MEMBER_CONTEXT,
    instance: {
      id: 'instance-1',
      state: 'RUNNING',
      templateId: 'template-1',
      templateVersionId: 'template-version-1',
      title: 'Purchase',
    },
    lastDecision: entry.lastDecision ?? null,
    principal: { memberId: 'member-200' },
    subject: MEMBER_CONTEXT,
  };
};

export const DIFFERENTIAL_CORPUS: readonly DifferentialCorpusEntry[] = [
  {
    id: 'S01',
    source: 'SEED',
    expression: 'form.systemName == "cloud-console"',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D01',
    source: 'DOCS',
    expression: 'form.amount > 1000000',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D02',
    source: 'DOCS',
    expression: 'form.amount < 100000',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'D03',
    source: 'DOCS',
    expression: "form.region == 'TW'",
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D04',
    source: 'DOCS',
    expression: "form.region in ['TW', 'JP', 'KR']",
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D05',
    source: 'DOCS',
    expression: "form.email == 'a@example.com'",
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D06',
    source: 'DOCS',
    expression: "form.email.contains('@example.com')",
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'D07',
    source: 'DOCS',
    expression: 'form.amount >= 100000 && form.amount <= 1000000',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'D08',
    source: 'DOCS',
    expression: "lastDecision != null && lastDecision.action == 'RETURNED'",
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'D09',
    source: 'DOCS',
    expression: "'manager' in initiator.roles",
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D10',
    source: 'DOCS',
    expression: "'admin' in subject.roles",
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D11',
    source: 'DOCS',
    expression: "form.amount > 100000 && initiator.org.code == 'FIN'",
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D12',
    source: 'DOCS',
    expression: "form.priority == 'urgent'",
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D13',
    source: 'DOCS',
    expression: "form.region == 'JP' ? 'JP_HEAD' : 'TW_HEAD'",
    expected: { legacy: 'ok:"TW_HEAD"', v2: 'ok:"TW_HEAD"' },
  },
  {
    id: 'D14',
    source: 'DOCS',
    expression: 'form.price * 2',
    expected: { legacy: 'ok:5', v2: 'ok:5' },
  },
  {
    id: 'D15',
    source: 'DOCS',
    expression: 'form.amount + 1',
    expected: { legacy: 'ok:1500001', v2: 'ok:1500001' },
  },
  {
    id: 'D16',
    source: 'DOCS',
    expression: 'form.amount * 2',
    expected: { legacy: 'ok:3000000', v2: 'ok:3000000' },
  },
  {
    id: 'D17',
    source: 'DOCS',
    expression: 'form.amount / 2',
    expected: { legacy: 'ok:750000', v2: 'ok:750000' },
  },
  {
    id: 'D18',
    source: 'DOCS',
    expression: '2 + form.price',
    expected: { legacy: 'ok:4.5', v2: 'ok:4.5' },
  },
  {
    id: 'D19',
    source: 'DOCS',
    expression: 'form.amount * 2 > 1.0',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D20',
    source: 'DOCS',
    expression: 'has(form.missing.deeper)',
    expected: { legacy: 'ok:false', v2: 'err:EXPRESSION_MISSING_KEY' },
  },
  {
    id: 'D21',
    source: 'DOCS',
    expression: 'form.missing == 1 || form.amount > 0',
    expected: { legacy: 'err:EXPRESSION_MISSING_KEY', v2: 'ok:true' },
  },
  {
    id: 'D22',
    source: 'DOCS',
    expression: 'form.missing == 1 && form.amount > 0',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'D23',
    source: 'DOCS',
    expression: 'form.amount < 0 && form.missing == 1',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'D24',
    source: 'DOCS',
    expression: 'form["sec"+"ret"]',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'D25',
    source: 'DOCS',
    expression: 'form["sec"]',
    expected: { legacy: 'ok:"x"', v2: 'ok:"x"' },
  },
  {
    id: 'D26',
    source: 'DOCS',
    expression: 'form["hyphen-key"]',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'D27',
    source: 'DOCS',
    expression: 'form.kind == "a" ? 1 : 2',
    expected: { legacy: 'ok:2', v2: 'ok:2' },
  },
  {
    id: 'D28',
    source: 'DOCS',
    expression: 'has(form.flag) ? 1 : 0',
    expected: { legacy: 'ok:1', v2: 'ok:1' },
  },
  {
    id: 'D29',
    source: 'DOCS',
    expression: 'form.items.all(x, x.qty > 0)',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'D30',
    source: 'DOCS',
    expression: 'form.constructor',
    expected: {
      legacy: 'err:EXPRESSION_INVALID_RESULT',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'D31',
    source: 'DOCS',
    expression: 'form.toString',
    expected: {
      legacy: 'err:EXPRESSION_INVALID_RESULT',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'D32',
    source: 'DOCS',
    expression: 'form.__proto__',
    expected: {
      legacy: 'err:EXPRESSION_INVALID_RESULT',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'D33',
    source: 'DOCS',
    expression: '{ "title": instance.title, "amount": form.amount }',
    expected: {
      legacy: 'err:EXPRESSION_TYPE_ERROR',
      v2: 'ok:{"amount":1500000,"title":"Purchase"}',
    },
  },
  {
    id: 'G01',
    source: 'DESIGNER',
    expression: 'form.amount > 1000',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G02',
    source: 'DESIGNER',
    expression: 'form.amount == 1500000',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G03',
    source: 'DESIGNER',
    expression: 'form.amount != 0',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G04',
    source: 'DESIGNER',
    expression: 'form.amount >= 1000.5',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G05',
    source: 'DESIGNER',
    expression: 'form.price <= 2.5',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G06',
    source: 'DESIGNER',
    expression: 'form.kind == "general"',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G07',
    source: 'DESIGNER',
    expression: 'form.flag == true',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G08',
    source: 'DESIGNER',
    expression: 'form.flag == false',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G09',
    source: 'DESIGNER',
    expression: 'form.note != null && form.note != ""',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G10',
    source: 'DESIGNER',
    expression: 'form.note == null || form.note == ""',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G11',
    source: 'DESIGNER',
    expression: 'form.empty != null && form.empty != ""',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G12',
    source: 'DESIGNER',
    expression: 'form.items != null && size(form.items) > 0',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G13',
    source: 'DESIGNER',
    expression: 'form.items == null || size(form.items) == 0',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G14',
    source: 'DESIGNER',
    expression: 'form.nothing == null || size(form.nothing) == 0',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'G15',
    source: 'DESIGNER',
    expression: 'form.nothing != null && size(form.nothing) > 0',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G16',
    source: 'DESIGNER',
    expression:
      'form.reviewer != null && form.reviewer != "" && form.reviewer != []',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G17',
    source: 'DESIGNER',
    expression:
      'form.reviewer == null || form.reviewer == "" || form.reviewer == []',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G18',
    source: 'DESIGNER',
    expression: 'form.owner != null && form.owner != "" && form.owner != []',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G19',
    source: 'DESIGNER',
    expression: 'form.multi != null && "A" in form.multi',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G20',
    source: 'DESIGNER',
    expression: '!(form.multi != null && "Z" in form.multi)',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G21',
    source: 'DESIGNER',
    expression: 'form.multi != null && form.multi != []',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G22',
    source: 'DESIGNER',
    expression: 'form.multi == null || form.multi == []',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G23',
    source: 'DESIGNER',
    expression: 'form.nothing != null && "A" in form.nothing',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G24',
    source: 'DESIGNER',
    expression: 'form["稅額"] > 0',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G25',
    source: 'DESIGNER',
    expression: 'form["a-b"] != null && "x\\"y" in form["a-b"]',
    expected: { legacy: 'ok:false', v2: 'ok:true' },
  },
  {
    id: 'G26',
    source: 'DESIGNER',
    expression:
      '("unit-1" in subject.orgUnitIds || "org-finance" in subject.orgUnitIds)',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'G27',
    source: 'DESIGNER',
    expression:
      '("unit-9" in subject.orgUnitIds) && "position-department-head" in subject.positionIds',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'G28',
    source: 'DESIGNER',
    expression:
      '("unit-1" in subject.orgUnitIds) && "position-department-head" in subject.positionIds',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F01',
    source: 'FIXTURE',
    expression: 'subject.orgUnitIds.size() > 0',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'F02',
    source: 'FIXTURE',
    expression: 'form.invoiceKind == "B2B"',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F03',
    source: 'FIXTURE',
    expression: 'form.invoiceKind == "B2B" && form.amount > 10',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F04',
    source: 'FIXTURE',
    expression: 'formData["invoiceKind"] == "B2B"',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F05',
    source: 'FIXTURE',
    expression: 'form.items[0].qty > 3',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'F06',
    source: 'FIXTURE',
    expression: 'form.items[0].qty',
    expected: { legacy: 'ok:3', v2: 'ok:3' },
  },
  {
    id: 'F07',
    source: 'FIXTURE',
    expression: 'form.items[5].qty > 1',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'F08',
    source: 'FIXTURE',
    expression: 'form.items[0].missing == null',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'F09',
    source: 'FIXTURE',
    expression: 'form.items.exists(row, row.qty > 2)',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F10',
    source: 'FIXTURE',
    expression: 'form.items.all(row, row.qty >= 0)',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F11',
    source: 'FIXTURE',
    expression: 'form.items.size() > 0',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'F12',
    source: 'FIXTURE',
    expression: 'size(form.items) == 2',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F13',
    source: 'FIXTURE',
    expression: 'has(form.items)',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F14',
    source: 'FIXTURE',
    expression: 'has(form.missing)',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'F15',
    source: 'FIXTURE',
    expression: 'form.tags != null && "urgent" in form.tags',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F16',
    source: 'FIXTURE',
    expression: 'form.tags == "urgent"',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'F17',
    source: 'FIXTURE',
    expression: 'form.amount.currency',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'F18',
    source: 'FIXTURE',
    expression: 'form.audit.level',
    expected: { legacy: 'ok:2', v2: 'ok:2' },
  },
  {
    id: 'F19',
    source: 'FIXTURE',
    expression: 'form.audit.level == 2',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F20',
    source: 'FIXTURE',
    expression: 'form.missing == 1',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'F21',
    source: 'FIXTURE',
    expression: 'size(form.invoiceKind)',
    expected: { legacy: 'ok:3', v2: 'ok:3' },
  },
  {
    id: 'F22',
    source: 'FIXTURE',
    expression:
      'form.amount > 0 && formData.amount > 0 && initiator.memberId != principal.memberId && instance.templateId != "" && env.now != ""',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F23',
    source: 'FIXTURE',
    expression: 'lastDecision != null && lastDecision.action == "APPROVED"',
    lastDecision: { action: 'APPROVED' },
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F24',
    source: 'FIXTURE',
    expression: 'initiator.memberId == "member-101"',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F25',
    source: 'FIXTURE',
    expression: 'instance.state == "RUNNING"',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F26',
    source: 'FIXTURE',
    expression: 'form.amount / 0',
    expected: {
      legacy: 'err:EXPRESSION_TYPE_ERROR',
      v2: 'err:EXPRESSION_TYPE_ERROR',
    },
  },
  {
    id: 'F27',
    source: 'FIXTURE',
    expression: 'form.email.contains("@")',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'F28',
    source: 'FIXTURE',
    expression: 'form.approvalLevel',
    expected: { legacy: 'ok:2', v2: 'ok:2' },
  },
  {
    id: 'F29',
    source: 'FIXTURE',
    expression: 'form.owner',
    expected: { legacy: 'ok:"member-201"', v2: 'ok:"member-201"' },
  },
  {
    id: 'F30',
    source: 'FIXTURE',
    expression: 'form.invoiceKind',
    expected: { legacy: 'ok:"B2B"', v2: 'ok:"B2B"' },
  },
  {
    id: 'F31',
    source: 'FIXTURE',
    expression: 'form.status == "account"',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'F32',
    source: 'FIXTURE',
    expression: 'form.amount >= 100000 && form.amount <= 1000000',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'F33',
    source: 'FIXTURE',
    expression: 'form.items.map(i, i.qty)',
    expected: { legacy: 'ok:[3,1]', v2: 'ok:[3,1]' },
  },
  {
    id: 'F34',
    source: 'FIXTURE',
    expression: 'size(form.items.map(a, form.items.map(b, a))) > 0',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'P01',
    source: 'PROBE',
    expression: '1 == 1.0',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'P02',
    source: 'PROBE',
    expression: '2.0 in [1, 2]',
    expected: { legacy: 'ok:true', v2: 'err:EXPRESSION_TYPE_ERROR' },
  },
  {
    id: 'P03',
    source: 'PROBE',
    expression: 'form.qty in [1, 2, 3]',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'P04',
    source: 'PROBE',
    expression: '7 / 2',
    expected: { legacy: 'ok:3.5', v2: 'ok:3' },
  },
  {
    id: 'P05',
    source: 'PROBE',
    expression: 'form.qty / 2',
    expected: { legacy: 'ok:1.5', v2: 'ok:1.5' },
  },
  {
    id: 'P06',
    source: 'PROBE',
    expression: '3 / form.price',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:1.2' },
  },
  {
    id: 'P07',
    source: 'PROBE',
    expression: '10 - form.price',
    expected: { legacy: 'ok:7.5', v2: 'ok:7.5' },
  },
  {
    id: 'P08',
    source: 'PROBE',
    expression: 'form.price / form.zero',
    expected: {
      legacy: 'err:EXPRESSION_TYPE_ERROR',
      v2: 'err:EXPRESSION_INVALID_RESULT',
    },
  },
  {
    id: 'P09',
    source: 'PROBE',
    expression: 'form.price / 0.0',
    expected: {
      legacy: 'err:EXPRESSION_TYPE_ERROR',
      v2: 'err:EXPRESSION_INVALID_RESULT',
    },
  },
  {
    id: 'P10',
    source: 'PROBE',
    expression: 'form.qty % form.qty',
    expected: { legacy: 'ok:0', v2: 'err:EXPRESSION_TYPE_ERROR' },
  },
  {
    id: 'P11',
    source: 'PROBE',
    expression: '{"a": "x", "b": 2}',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:{"a":"x","b":2}' },
  },
  {
    id: 'P12',
    source: 'PROBE',
    expression: '[1, "a"]',
    expected: { legacy: 'ok:[1,"a"]', v2: 'ok:[1,"a"]' },
  },
  {
    id: 'P13',
    source: 'PROBE',
    expression: 'true ? 1 : 2',
    expected: { legacy: 'ok:1', v2: 'ok:1' },
  },
  {
    id: 'P14',
    source: 'PROBE',
    expression: 'form.flag ? form.amount : 0',
    expected: { legacy: 'ok:1500000', v2: 'ok:1500000' },
  },
  {
    id: 'P15',
    source: 'PROBE',
    expression: 'form.note + "!"',
    expected: { legacy: 'ok:"audit!"', v2: 'ok:"audit!"' },
  },
  {
    id: 'P16',
    source: 'PROBE',
    expression: 'form.note + 1',
    expected: {
      legacy: 'err:EXPRESSION_TYPE_ERROR',
      v2: 'err:EXPRESSION_TYPE_ERROR',
    },
  },
  {
    id: 'P17',
    source: 'PROBE',
    expression: 'form.amount > "1"',
    expected: {
      legacy: 'err:EXPRESSION_TYPE_ERROR',
      v2: 'err:EXPRESSION_TYPE_ERROR',
    },
  },
  {
    id: 'P18',
    source: 'PROBE',
    expression: 'form.nothing == null',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'P19',
    source: 'PROBE',
    expression: 'form.missing == null',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'P20',
    source: 'PROBE',
    expression: 'null',
    expected: { legacy: 'ok:null', v2: 'ok:null' },
  },
  {
    id: 'P21',
    source: 'PROBE',
    expression: '[1, 2].all(x, x > 0)',
    expected: { legacy: 'err:EXPRESSION_SYNTAX_ERROR', v2: 'ok:true' },
  },
  {
    id: 'P22',
    source: 'PROBE',
    expression: '9007199254740993',
    expected: {
      legacy: 'err:EXPRESSION_INVALID_RESULT',
      v2: 'err:EXPRESSION_INVALID_RESULT',
    },
  },
  {
    id: 'P23',
    source: 'PROBE',
    expression: 'form.amount * 10000000000',
    expected: {
      legacy: 'err:EXPRESSION_INVALID_RESULT',
      v2: 'err:EXPRESSION_INVALID_RESULT',
    },
  },
  {
    id: 'P24',
    source: 'PROBE',
    expression: 'form.email.startsWith("a")',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'P25',
    source: 'PROBE',
    expression: 'form.email.matches("^a@")',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'P26',
    source: 'PROBE',
    expression: 'string(form.qty)',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:"3"' },
  },
  {
    id: 'P27',
    source: 'PROBE',
    expression: 'int(form.price)',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:2' },
  },
  {
    id: 'P28',
    source: 'PROBE',
    expression: 'form.multi.filter(x, x == "A").size() == 1',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'P29',
    source: 'PROBE',
    expression: 'form.items.exists(row, row.missing == 1)',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'P30',
    source: 'PROBE',
    expression: 'form.multi == ["A", "B"]',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'P31',
    source: 'PROBE',
    expression: 'form.audit == {"level": 2}',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'P32',
    source: 'PROBE',
    expression: '-form.amount',
    expected: { legacy: 'ok:-1500000', v2: 'ok:-1500000' },
  },
  {
    id: 'P33',
    source: 'PROBE',
    expression: '!form.flag',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'P34',
    source: 'PROBE',
    expression: 'form.amount > 1 == true',
    expected: { legacy: 'err:EXPRESSION_SYNTAX_ERROR', v2: 'ok:true' },
  },
  {
    id: 'P35',
    source: 'PROBE',
    expression: 'form.price / form.zero > 1',
    expected: { legacy: 'err:EXPRESSION_TYPE_ERROR', v2: 'ok:true' },
  },
  {
    id: 'P36',
    source: 'PROBE',
    expression: 'size(form.items) / 2',
    expected: { legacy: 'ok:1', v2: 'ok:1' },
  },
  {
    id: 'P37',
    source: 'PROBE',
    expression: 'form.qty in [1, 2.5]',
    expected: { legacy: 'ok:false', v2: 'ok:false' },
  },
  {
    id: 'P38',
    source: 'PROBE',
    expression: '"x\\"y" == "x" + "\\"" + "y"',
    expected: { legacy: 'ok:true', v2: 'ok:true' },
  },
  {
    id: 'P39',
    source: 'PROBE',
    expression: 'size("x\\"y")',
    expected: { legacy: 'ok:4', v2: 'ok:3' },
  },
  {
    id: 'P40',
    source: 'PROBE',
    expression: 'form.missing != null && form.missing == 1',
    expected: {
      legacy: 'err:EXPRESSION_MISSING_KEY',
      v2: 'err:EXPRESSION_MISSING_KEY',
    },
  },
  {
    id: 'P41',
    source: 'PROBE',
    expression: 'true || form.missing == 1',
    expected: { legacy: 'err:EXPRESSION_MISSING_KEY', v2: 'ok:true' },
  },
  {
    id: 'P42',
    source: 'PROBE',
    expression: 'form.missing == 1 || true',
    expected: { legacy: 'err:EXPRESSION_MISSING_KEY', v2: 'ok:true' },
  },
  // Reserved keys written in a map literal. cel-v2 drops them while building
  // the map (`safeFromEntries`), so the walker never sees them; cel-legacy
  // keeps them and the walker refuses the result.
  {
    id: 'P43',
    source: 'PROBE',
    expression: '{"constructor": 1}',
    expected: { legacy: 'err:EXPRESSION_INVALID_RESULT', v2: 'ok:{}' },
  },
  {
    id: 'P44',
    source: 'PROBE',
    expression: '{"__proto__": {"polluted": true}}',
    expected: { legacy: 'err:EXPRESSION_INVALID_RESULT', v2: 'ok:{}' },
  },
  {
    id: 'P45',
    source: 'PROBE',
    expression: '{"a": 1, "prototype": 2}',
    expected: { legacy: 'err:EXPRESSION_INVALID_RESULT', v2: 'ok:{"a":1}' },
  },
];
