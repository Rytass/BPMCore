import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isTableFieldDefinition,
  readNodeFillUnits,
  TableColumnDefinition,
  UserTaskNode,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared';

import { computeStableValueFingerprint } from './form-data-fingerprint';

/**
 * What the user tasks of one workflow let an approver fill (ADR 27 §4(a)),
 * split for a submission.
 *
 * `wholeKeys` are top-level fields granted whole. An end user's value for one
 * is dropped and the field is only shape checked, as before.
 *
 * `openColumnsByTable` maps a table granted only per column to the column keys
 * an approver fills. The table itself stays with the applicant (its rows are
 * theirs to add, and the approver may not change their row structure); only
 * those cells wait for the approver. Nobody can fill them before the approval
 * node, so their required flags do not apply at submission.
 */
export interface ApproverFilledDeferral {
  readonly openColumnsByTable: ReadonlyMap<string, ReadonlySet<string>>;
  readonly wholeKeys: ReadonlySet<string>;
}

type FormRow = Readonly<Record<string, unknown>>;

const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

const isFormRow = (value: unknown): value is FormRow =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUserTaskNode = (node: {
  readonly type: string;
}): node is UserTaskNode => node.type === 'userTask';

export const readApproverFilledDeferral = (
  definition: WorkflowDefinition,
): ApproverFilledDeferral => {
  const units = definition.nodes
    .filter(isUserTaskNode)
    .flatMap((node) => readNodeFillUnits(node));
  const wholeKeys = new Set(
    units
      .filter((unit) => unit.columnKey === null)
      .map((unit) => unit.fieldKey),
  );
  const columnPairs = units.flatMap(
    (unit): readonly (readonly [string, string])[] =>
      unit.columnKey === null || wholeKeys.has(unit.fieldKey)
        ? []
        : [[unit.fieldKey, unit.columnKey]],
  );
  const openColumnsByTable = new Map(
    [...new Set(columnPairs.map(([fieldKey]) => fieldKey))].map(
      (fieldKey): readonly [string, ReadonlySet<string>] => [
        fieldKey,
        new Set(
          columnPairs
            .filter(([key]) => key === fieldKey)
            .map(([, columnKey]) => columnKey),
        ),
      ],
    ),
  );

  return { openColumnsByTable, wholeKeys };
};

/**
 * The schema a submission is validated against: each open column of a
 * deferred table is not required. Its type and a host-supplied value are still
 * checked, and the table's own rules (`minRows`, `maxRows`) are untouched.
 */
export const projectOpenColumnsOptional = (
  schema: FormDefinitionSchema,
  deferral: ApproverFilledDeferral,
): FormDefinitionSchema => ({
  ...schema,
  fields: schema.fields.map((field): FormFieldDefinition => {
    const openColumns = isTableFieldDefinition(field)
      ? deferral.openColumnsByTable.get(field.fieldKey)
      : undefined;

    if (!isTableFieldDefinition(field) || openColumns === undefined) {
      return field;
    }

    return {
      ...field,
      columns: field.columns.map((column): TableColumnDefinition =>
        openColumns.has(column.fieldKey)
          ? { ...column, required: false }
          : column,
      ),
    };
  }),
});

/**
 * The cells of a row the applicant owns: every column that is not open.
 */
const readApplicantCells = (
  row: FormRow,
  openColumns: ReadonlySet<string>,
): FormRow =>
  Object.fromEntries(
    Object.entries(row).filter(([column]) => !openColumns.has(column)),
  );

/**
 * Settles the open cells of each row of a deferred table. The submitted cell
 * is dropped. The stored cell comes back only for a row the stored data has
 * that cell on, and only when the applicant's own cells on that row equal the
 * stored row's at the same position. Rows are matched by position (no row id),
 * so a reordered, deleted or inserted row that now sits where a different row
 * was would otherwise inherit an approver's value that judged another record.
 * Such a row keeps no open cell and the later approver fills it again. A row
 * past the stored length gets none. `stored` is `null` on a first submission,
 * so no open cell survives it.
 */
export const applyOpenColumnCells = (
  formData: FormRow,
  stored: FormRow | null,
  deferral: ApproverFilledDeferral,
): FormRow =>
  Object.fromEntries(
    Object.entries(formData).map(([key, value]): readonly [string, unknown] => {
      const openColumns = deferral.openColumnsByTable.get(key);

      if (openColumns === undefined || !Array.isArray(value)) {
        return [key, value];
      }

      const storedValue = stored === null ? undefined : stored[key];
      const storedRows: readonly unknown[] = Array.isArray(storedValue)
        ? storedValue
        : [];

      return [
        key,
        value.map((row: unknown, index: number): unknown => {
          if (!isFormRow(row)) {
            return row;
          }

          const kept = readApplicantCells(row, openColumns);
          const storedRow = storedRows[index];

          if (!isFormRow(storedRow)) {
            return kept;
          }

          const sameRecord =
            computeStableValueFingerprint(kept) ===
            computeStableValueFingerprint(
              readApplicantCells(storedRow, openColumns),
            );

          if (!sameRecord) {
            return kept;
          }

          const restored = Object.fromEntries(
            [...openColumns]
              .filter((column) => hasOwn(storedRow, column))
              .map((column): readonly [string, unknown] => [
                column,
                storedRow[column],
              ]),
          );

          return { ...kept, ...restored };
        }),
      ];
    }),
  );
