import {
  isFormDataValueEmpty,
  omitFormDataKeys,
  readApproverFilledFieldKeys,
  readNodeFillableFieldKeys,
  readNodeRequiredFieldKeys,
  type UserTaskNode,
  type WorkflowDefinition,
} from '@rytass/bpm-core-shared';
import {
  isFormStaticOptionFieldDefinition,
  isOrgUnitFieldDefinition,
  isTableFieldDefinition,
  type FormDefinitionSchema,
  type FormFieldDefinition,
  type FormFieldValue,
  type TableColumnDefinition,
} from '@rytass/bpm-core-shared/form';
import { readFormTableRows } from '@rytass/bpm-core-client/form';
import type { WorkflowFormData } from '@rytass/bpm-core-client/workflow';

/**
 * The form as the applicant sees it: without the fields some approver fills in.
 * The server drops those keys from a submission, so rendering one would swallow
 * what the applicant types, and a `minRows` or `required` on it would block a
 * launch nobody can complete. Returns an equal schema when nothing is
 * approver-filled; never mutates its input.
 */
export function readApplicantFormSchema(
  schema: FormDefinitionSchema,
  definition: WorkflowDefinition,
): FormDefinitionSchema {
  const approverFilledKeys = readApproverFilledFieldKeys(definition);

  return {
    ...schema,
    fields: schema.fields.filter(
      (field) => !approverFilledKeys.has(field.fieldKey),
    ),
  };
}

/** The payload the applicant may send: `values` without approver-filled keys. */
export function readApplicantSubmission(
  values: WorkflowFormData,
  definition: WorkflowDefinition,
): WorkflowFormData {
  // Dropping keys cannot change a remaining value's type, which is all the
  // shared helper's `unknown` return forgets.
  return omitFormDataKeys(
    values,
    readApproverFilledFieldKeys(definition),
  ) as WorkflowFormData;
}

/**
 * The form an approver's fill is validated against: only the fields `node`
 * lets them fill in, each required exactly when the node says `REQUIRED`. A
 * required table needs at least one row, the rule `validateFormRendererValues`
 * already applies, so the result agrees with the server's fill check. Never
 * mutates its input.
 */
export function readFillValidationSchema(
  schema: FormDefinitionSchema,
  node: UserTaskNode,
): FormDefinitionSchema {
  const fillableKeys = readNodeFillableFieldKeys(node);
  const displaySchema = readFillDisplaySchema(schema, node);

  // Derived from the display schema so the check and the asterisk read the
  // same rule.
  return {
    ...displaySchema,
    fields: displaySchema.fields.filter((field) =>
      fillableKeys.has(field.fieldKey),
    ),
  };
}

/**
 * The schema the fill node's approver sees: every field as the form defines
 * it, except that the node's fillable fields are required exactly when the
 * node says `REQUIRED`, so the asterisk matches what approving will check.
 */
export function readFillDisplaySchema(
  schema: FormDefinitionSchema,
  node: UserTaskNode,
): FormDefinitionSchema {
  const fillableKeys = readNodeFillableFieldKeys(node);
  const requiredKeys = readNodeRequiredFieldKeys(node);

  return {
    ...schema,
    fields: schema.fields.map((field) =>
      fillableKeys.has(field.fieldKey)
        ? {
            ...field,
            required: requiredKeys.has(field.fieldKey),
            // The node alone decides; the server ignores the form's rule.
            requiredWhen: undefined,
          }
        : field,
    ),
  };
}

const userTaskNodes = (definition: WorkflowDefinition): readonly UserTaskNode[] =>
  definition.nodes.filter(
    (node): node is UserTaskNode => node.type === 'userTask',
  );

/**
 * The marker shown after each approver-filled field's label: 「本關補填」 on
 * the fields `viewerFillNode` lets the viewer fill, 「<node>補填」 on every
 * other approver-filled field (the first node in the definition that fills
 * it names it).
 */
export function readFillLabelMarkers(
  definition: WorkflowDefinition,
  viewerFillNode: UserTaskNode | null,
): Readonly<Record<string, string>> {
  const viewerKeys =
    viewerFillNode === null
      ? new Set<string>()
      : readNodeFillableFieldKeys(viewerFillNode);

  return userTaskNodes(definition).reduce<Readonly<Record<string, string>>>(
    (markers, node) => ({
      ...Object.fromEntries(
        [...readNodeFillableFieldKeys(node)].map((fieldKey) => [
          fieldKey,
          viewerKeys.has(fieldKey)
            ? '本關補填'
            : `${node.data.label || node.id}補填`,
        ]),
      ),
      ...markers,
    }),
    {},
  );
}

/**
 * What approving sends as `fill.formData`: the keys of `values` that `node`
 * lets its approver fill, and nothing else (the server refuses any other key).
 * `values` is what the approver changed, not the rendered form — a renderer
 * default the approver never touched (a table's empty rows, a boolean's
 * `false`) is not theirs to sign, and would otherwise show up as filled in.
 */
export function readFillPayload(
  values: WorkflowFormData,
  node: UserTaskNode,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    [...readNodeFillableFieldKeys(node)]
      .filter((fieldKey) =>
        Object.prototype.hasOwnProperty.call(values, fieldKey),
      )
      // A cleared field reads `undefined`, which JSON drops, and the server
      // would keep the old value; `null` clears it.
      .map((fieldKey) => [fieldKey, values[fieldKey] ?? null]),
  );
}

/**
 * What the approver's fill amounts to: the fields they changed (`draft`), plus
 * each fill table the page seeds with `minRows` rows that the case does not
 * store yet. The page shows those rows and validates them, so they are sent
 * too — left out, the server would refuse the approval for missing rows the
 * approver can see on screen.
 */
export function readFillChanges({
  draft,
  node,
  schema,
  stored,
  values,
}: {
  readonly draft: WorkflowFormData;
  readonly node: UserTaskNode;
  readonly schema: FormDefinitionSchema;
  readonly stored: WorkflowFormData;
  readonly values: WorkflowFormData;
}): WorkflowFormData {
  const fillableKeys = readNodeFillableFieldKeys(node);
  const seededTables = schema.fields.filter((field) => {
    const seeded = values[field.fieldKey];

    return (
      isTableFieldDefinition(field) &&
      fillableKeys.has(field.fieldKey) &&
      !Object.prototype.hasOwnProperty.call(stored, field.fieldKey) &&
      Array.isArray(seeded) &&
      seeded.length > 0
    );
  });

  return {
    ...Object.fromEntries(
      seededTables.map((field) => [field.fieldKey, values[field.fieldKey]]),
    ),
    ...draft,
  };
}

/** The server message of a fill against form data someone else changed. */
export function isFillConflictMessage(message: string): boolean {
  return message.includes('form data changed; refresh and retry');
}

// The server names a field by its label: `欄位「標籤」`, a table row as
// `「表格」第 N 列` (1-based), and a cell as `「表格」第 N 列的「欄位」`.
// Each part of a message is separated by `；`.
const TOP_LEVEL_REF_PATTERN = /^欄位「(.+?)」(.+)$/;
const TABLE_REF_PATTERN = /^「(.+?)」第 (\d+) 列(?:的「(.+?)」)?(.+)$/;
const MISSING_FIELDS_PREFIX = '缺少必填欄位：';

/** The field, or table column, a server error part names, with its renderer key. */
interface FillErrorTarget {
  readonly key: string;
  readonly settings: FormFieldDefinition | TableColumnDefinition | undefined;
}

function readFillErrorTarget(
  part: string,
  fields: readonly FormFieldDefinition[],
): { readonly target: FillErrorTarget; readonly reason: string } | null {
  const topLevel = TOP_LEVEL_REF_PATTERN.exec(part);

  if (topLevel) {
    const field = fields.find(
      (candidate) => (candidate.label || candidate.fieldKey) === topLevel[1],
    );

    return field
      ? {
          reason: topLevel[2],
          target: { key: field.fieldKey, settings: field },
        }
      : null;
  }

  const tableRef = TABLE_REF_PATTERN.exec(part);

  if (!tableRef) {
    return null;
  }

  const table = fields.find(
    (candidate) =>
      isTableFieldDefinition(candidate) &&
      (candidate.label || candidate.fieldKey) === tableRef[1],
  );

  if (!table || !isTableFieldDefinition(table)) {
    return null;
  }

  const rowKey = `${table.fieldKey}[${Number(tableRef[2]) - 1}]`;
  const columnLabel = tableRef[3];

  if (columnLabel === undefined) {
    return {
      reason: tableRef[4],
      target: { key: rowKey, settings: undefined },
    };
  }

  const column = table.columns.find(
    (candidate) => (candidate.label || candidate.fieldKey) === columnLabel,
  );

  return column
    ? {
        reason: tableRef[4],
        target: { key: `${rowKey}.${column.fieldKey}`, settings: column },
      }
    : null;
}

function readFillPathErrorText(
  reason: string,
  settings: FormFieldDefinition | TableColumnDefinition | undefined,
): string {
  const atLeastRows = /^至少需要 (\d+) 列$/.exec(reason);
  const atMostRows = /^最多 (\d+) 列$/.exec(reason);
  const shortest = /^至少需要 (\d+) 個字$/.exec(reason);
  const longest = /^最多 (\d+) 個字$/.exec(reason);

  if (reason === '為必填') {
    return '此欄為必填。';
  }

  if (atLeastRows) {
    return `至少需要 ${atLeastRows[1]} 列。`;
  }

  if (atMostRows) {
    return `最多 ${atMostRows[1]} 列。`;
  }

  if (shortest) {
    return `至少需要 ${shortest[1]} 個字。`;
  }

  if (longest) {
    return `最多 ${longest[1]} 個字。`;
  }

  if (reason === '格式不正確') {
    const message =
      settings && (settings.type === 'text' || settings.type === 'textarea')
        ? settings.patternErrorMessage?.trim()
        : undefined;

    return message || '格式不正確。';
  }

  // The server ran out of time on the format check; the value may be fine.
  if (reason === '無法在時限內完成格式檢查') {
    return '格式檢查逾時，請縮短內容後再試，或請表單設計者簡化格式。';
  }

  return '此欄內容不正確。';
}

/**
 * Turns the server's fill validation message (docs/08 §8.5, error table 2)
 * into field errors keyed the way `FormRenderer` addresses them, so a check
 * the page missed still lands on the field. `null` when any part does not
 * parse — the caller then shows the message as it is.
 */
export function readFillServerErrors(
  message: string,
  schema: FormDefinitionSchema,
  node: UserTaskNode,
): Readonly<Record<string, string>> | null {
  const fillableFields = schema.fields.filter((field) =>
    readNodeFillableFieldKeys(node).has(field.fieldKey),
  );

  if (message.startsWith(MISSING_FIELDS_PREFIX)) {
    // Labels may hold commas, so match each fillable field's label (or key)
    // against the list rather than splitting it.
    const listed = `, ${message.slice(MISSING_FIELDS_PREFIX.length)}, `;
    const missing = fillableFields.filter((field) =>
      listed.includes(`, ${field.label || field.fieldKey}, `),
    );

    return missing.length > 0
      ? Object.fromEntries(
          missing.map((field) => [
            field.fieldKey,
            `${field.label || field.fieldKey}為必填欄位。`,
          ]),
        )
      : null;
  }

  const parts = message
    .split('；')
    .map((part) => readFillErrorTarget(part, fillableFields));

  if (parts.length === 0 || parts.some((part) => part === null)) {
    return null;
  }

  return Object.fromEntries(
    parts.flatMap((part) =>
      part === null
        ? []
        : [
            [
              part.target.key,
              readFillPathErrorText(part.reason, part.target.settings),
            ],
          ],
    ),
  );
}

export interface FillSummaryItem {
  readonly fieldKey: string;
  readonly label: string;
  readonly text: string;
}

export const UNKNOWN_FILL_ORG_UNIT_TEXT = '未知組織';

/**
 * The org unit ids among `values`, once each and in form order, so the caller
 * can look up their names before building the summary.
 */
export function readFillOrgUnitIds(
  schema: FormDefinitionSchema,
  values: WorkflowFormData,
): readonly string[] {
  return [
    ...new Set(
      schema.fields
        .filter(isOrgUnitFieldDefinition)
        .map((field) => values[field.fieldKey])
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        ),
    ),
  ];
}

function readFillValueText(
  field: FormFieldDefinition,
  value: FormFieldValue | undefined,
  memberNames: ReadonlyMap<string, string>,
  orgUnitNames: ReadonlyMap<string, string>,
): string {
  if (isTableFieldDefinition(field)) {
    const rows = readFormTableRows(value);
    const totals = field.columns
      .filter((column) => column.type === 'number' || column.type === 'money')
      .map((column) => ({
        label: column.label || column.fieldKey,
        total: rows.reduce(
          (sum, row) =>
            typeof row[column.fieldKey] === 'number' &&
            Number.isFinite(row[column.fieldKey])
              ? sum + (row[column.fieldKey] as number)
              : sum,
          0,
        ),
      }));

    return [
      `${rows.length} 列`,
      ...(rows.length > 0
        ? totals.map(
            ({ label, total }) => `${label}合計 ${total.toLocaleString('zh-TW')}`,
          )
        : []),
    ].join('，');
  }

  if (isFormDataValueEmpty(value)) {
    return '未填寫';
  }

  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }

  if (isOrgUnitFieldDefinition(field)) {
    // `orgUnitNames` (`useOrgUnitNames`) maps an id still being looked up to
    // a loading text; an id the lookup did not name is 「未知組織」. Never the
    // raw id.
    return typeof value === 'string'
      ? (orgUnitNames.get(value) ?? UNKNOWN_FILL_ORG_UNIT_TEXT)
      : UNKNOWN_FILL_ORG_UNIT_TEXT;
  }

  const items = Array.isArray(value) ? value : [value];
  const optionLabels = isFormStaticOptionFieldDefinition(field)
    ? new Map(field.options.map((option) => [option.value, option.label]))
    : field.type === 'member'
      ? memberNames
      : new Map<string, string>();

  return items
    .map((item) =>
      typeof item === 'string' ? (optionLabels.get(item) ?? item) : String(item),
    )
    .join('、');
}

/**
 * One line per field `node` lets its approver fill, in form order, for the
 * approve dialog: what will be sent along with the approval. A member field
 * names each member found in `memberNames` and shows the id otherwise; an org
 * unit field names its unit from `orgUnitNames` and shows 「未知組織」 otherwise.
 */
export function readFillSummary(
  schema: FormDefinitionSchema,
  node: UserTaskNode,
  values: WorkflowFormData,
  memberNames: ReadonlyMap<string, string> = new Map(),
  orgUnitNames: ReadonlyMap<string, string> = new Map(),
): readonly FillSummaryItem[] {
  const fillableKeys = readNodeFillableFieldKeys(node);

  return schema.fields
    .filter(
      (field) =>
        fillableKeys.has(field.fieldKey) &&
        Object.prototype.hasOwnProperty.call(values, field.fieldKey),
    )
    .map((field) => ({
      fieldKey: field.fieldKey,
      label: field.label || field.fieldKey,
      text: readFillValueText(
        field,
        values[field.fieldKey],
        memberNames,
        orgUnitNames,
      ),
    }));
}
