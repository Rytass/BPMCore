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
  isTableFieldDefinition,
  type FormDefinitionSchema,
  type FormFieldDefinition,
  type FormFieldValue,
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
  const requiredKeys = readNodeRequiredFieldKeys(node);

  return {
    ...schema,
    fields: schema.fields
      .filter((field) => fillableKeys.has(field.fieldKey))
      .map((field) => ({
        ...field,
        required: requiredKeys.has(field.fieldKey),
      })),
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
        ? { ...field, required: requiredKeys.has(field.fieldKey) }
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
      .map((fieldKey) => [fieldKey, values[fieldKey]]),
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

const FORM_DATA_PATH_PATTERN =
  /^formData\.([A-Za-z_][A-Za-z0-9_]*(?:\[\d+\]\.[A-Za-z_][A-Za-z0-9_]*)?) (.+)$/;
const MISSING_FIELDS_PREFIX = 'Form data is missing required fields: ';

function readFillPathErrorText(path: string, reason: string): string {
  const atLeast = /^must include at least (\d+) row\(s\)$/.exec(reason);
  const atMost = /^must include at most (\d+) row\(s\)$/.exec(reason);

  if (reason === 'is required') {
    return '此欄為必填。';
  }

  if (atLeast) {
    return `至少需要 ${atLeast[1]} 列。`;
  }

  if (atMost) {
    return `最多 ${atMost[1]} 列。`;
  }

  return path.includes('[') ? '此欄內容不正確。' : '此欄位內容不正確。';
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

  const parts = message.split('; ').map((part) => FORM_DATA_PATH_PATTERN.exec(part));

  if (parts.length === 0 || parts.some((part) => part === null)) {
    return null;
  }

  return Object.fromEntries(
    parts.flatMap((part) =>
      part === null ? [] : [[part[1], readFillPathErrorText(part[1], part[2])]],
    ),
  );
}

export interface FillSummaryItem {
  readonly fieldKey: string;
  readonly label: string;
  readonly text: string;
}

function readFillValueText(
  field: FormFieldDefinition,
  value: FormFieldValue | undefined,
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

  const items = Array.isArray(value) ? value : [value];
  const optionLabels = isFormStaticOptionFieldDefinition(field)
    ? new Map(field.options.map((option) => [option.value, option.label]))
    : new Map<string, string>();

  return items
    .map((item) =>
      typeof item === 'string' ? (optionLabels.get(item) ?? item) : String(item),
    )
    .join('、');
}

/**
 * One line per field `node` lets its approver fill, in form order, for the
 * approve dialog: what will be sent along with the approval.
 */
export function readFillSummary(
  schema: FormDefinitionSchema,
  node: UserTaskNode,
  values: WorkflowFormData,
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
      text: readFillValueText(field, values[field.fieldKey]),
    }));
}
