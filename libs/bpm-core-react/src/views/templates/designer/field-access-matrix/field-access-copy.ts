import {
  readNodeFieldAccess,
  type FieldAccessChoice,
  type FieldAccessEffective,
  type FieldAccessIssue,
  type FieldAccessIssueCode,
  type FieldAccessMatrixColumn,
} from '@rytass/bpm-core-shared';
import type { UserTaskNode } from '@rytass/bpm-core-shared/workflow';

export const FIELD_ACCESS_CHOICE_LABELS: Readonly<
  Record<FieldAccessChoice, string>
> = {
  DEFAULT: '預設',
  FILL_OPTIONAL: '補填（選填）',
  FILL_REQUIRED: '補填（必填）',
  HIDE: '隱藏',
  SHOW: '顯示',
};

export const FIELD_ACCESS_EFFECTIVE_LABELS: Readonly<
  Record<FieldAccessEffective, string>
> = {
  FILL: '填寫',
  FILL_OPTIONAL: '補填（選填）',
  FILL_REQUIRED: '補填（必填）',
  HIDDEN: '隱藏',
  NOT_SHOWN: '不顯示',
  READ_ONLY: '唯讀',
};

/**
 * Why the form will not let an approver fill a field in, short enough for the
 * matrix's check column. The full lint line is shown once the field is
 * actually set to be filled in.
 */
export const FIELD_ACCESS_FILL_BLOCKER_LABELS: Readonly<
  Partial<Record<FieldAccessIssueCode, string>>
> = {
  approverFilledFieldDataSource: '選項來自資料來源，不能補填',
  approverFilledFieldFileUpload: '檔案上傳欄位不能補填',
  approverFilledFieldFormRule: '表單已設定必填、顯示或預設值等規則，不能補填',
  approverFilledTableDataSourceColumn: '表格含資料來源欄，不能補填',
};

export const FIELD_ACCESS_BOOLEAN_REQUIRED_NOTE =
  '開關欄位只能選填補填：開關關著也是答案，不能要求必填。';

export const FIELD_ACCESS_HIDE_NOTE =
  '「隱藏」只影響這一關的畫面，不是權限：資料查詢仍拿得到值，不能用來保密。';

export function readFieldAccessStageLabel(
  column: Pick<FieldAccessMatrixColumn, 'stage'>,
): string {
  return `關卡 ${column.stage}`;
}

export interface FieldAccessNodeCounts {
  readonly fill: number;
  readonly hidden: number;
  readonly required: number;
}

export function readFieldAccessNodeCounts(
  node: UserTaskNode,
): FieldAccessNodeCounts {
  const entries = readNodeFieldAccess(node);

  return {
    fill: entries.filter((entry) => entry.fill !== 'NONE').length,
    hidden: entries.filter(
      (entry) => entry.fill === 'NONE' && entry.display === 'HIDE',
    ).length,
    required: entries.filter((entry) => entry.fill === 'REQUIRED').length,
  };
}

/** The node card's tag, e.g. 「補填 2 · 隱藏 1」; `null` with nothing set. */
export function readFieldAccessNodeTag(node: UserTaskNode): string | null {
  const { fill, hidden } = readFieldAccessNodeCounts(node);
  const parts = [
    ...(fill > 0 ? [`補填 ${fill}`] : []),
    ...(hidden > 0 ? [`隱藏 ${hidden}`] : []),
  ];

  return parts.length ? parts.join(' · ') : null;
}

const FILL_CONFLICT_CODES: ReadonlySet<FieldAccessIssueCode> = new Set([
  'fieldAccessAutoApprove',
  'fieldAccessGroupPolicy',
  'fieldAccessSkipNode',
]);

export function isFillConflictIssue(issue: FieldAccessIssue): boolean {
  return FILL_CONFLICT_CODES.has(issue.code);
}
