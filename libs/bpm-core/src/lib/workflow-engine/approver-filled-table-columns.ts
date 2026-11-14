import { ConflictException } from '@nestjs/common';

import {
  FieldAccessFillUnit,
  FormDataSourceValueSnapshots,
  FormDefinitionSchema,
  FormFieldDefinition,
  isFormDataSourceFieldDefinition,
  isTableFieldDefinition,
  readFieldAccessDependencyBreaks,
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

export const APPROVER_FILL_ERROR_CODES = {
  CELL_LOCKED: 'FORM_FIELD_ACCESS_CELL_LOCKED',
  DEPENDENT_COLUMN_STALE: 'FORM_FIELD_ACCESS_DEPENDENT_COLUMN_STALE',
  TABLE_ROWS_LOCKED: 'FORM_FIELD_ACCESS_TABLE_ROWS_LOCKED',
} as const;

const readColumnFingerprints = (
  rows: unknown,
  columnKey: string,
): readonly string[] =>
  Array.isArray(rows)
    ? rows.map(
        (row: unknown): string =>
          computeStableValueFingerprint(
            isFormRow(row) ? row[columnKey] : undefined,
          ),
      )
    : [];

/**
 * Fails closed when an approver changes a column that a column the approver
 * may not fill reads (ADR 27 §4.3). The dependent column keeps its stored value
 * and is not re-resolved, so a changed source would leave it stale. Current
 * publish lint rejects such a template; this guards templates published before
 * that rule. A dependent that is open to the same node is re-resolved at
 * decide, so it is not a break.
 */
export const assertDependentColumnsFrozen = (
  schema: FormDefinitionSchema | null,
  node: UserTaskNode,
  storedFormData: Readonly<Record<string, unknown>>,
  mergedFormData: Readonly<Record<string, unknown>>,
): void => {
  const stale = readFieldAccessDependencyBreaks(
    schema,
    readNodeFillUnits(node),
  ).find(
    ({ fieldKey, sourceColumnKey }): boolean =>
      readColumnFingerprints(storedFormData[fieldKey], sourceColumnKey).join(
        '\n',
      ) !==
      readColumnFingerprints(mergedFormData[fieldKey], sourceColumnKey).join(
        '\n',
      ),
  );

  if (stale !== undefined) {
    throw new ConflictException({
      code: APPROVER_FILL_ERROR_CODES.DEPENDENT_COLUMN_STALE,
      message: `Column ${stale.sourceColumnKey} of table ${stale.fieldKey} is read by column ${stale.dependentColumnKey}, which an approver may not change at this step`,
    });
  }
};

type ColumnFill = FieldAccessFillUnit['fill'];

/**
 * The table columns one user task lets its approver fill (ADR 27 §4(a)), keyed
 * by table, each with its fill. A table granted whole in the same node is left
 * out: that grant is the whole-field path and is checked as before.
 */
export type NodeColumnFillMap = ReadonlyMap<
  string,
  ReadonlyMap<string, ColumnFill>
>;

export const readNodeColumnFillMap = (
  node: UserTaskNode,
): NodeColumnFillMap => {
  const units = readNodeFillUnits(node);
  const wholeKeys = new Set(
    units
      .filter((unit) => unit.columnKey === null)
      .map((unit) => unit.fieldKey),
  );
  const columnUnits = units.filter(
    (unit): unit is FieldAccessFillUnit & { readonly columnKey: string } =>
      unit.columnKey !== null && !wholeKeys.has(unit.fieldKey),
  );

  return new Map(
    [...new Set(columnUnits.map((unit) => unit.fieldKey))].map(
      (fieldKey): readonly [string, ReadonlyMap<string, ColumnFill>] => [
        fieldKey,
        new Map(
          columnUnits
            .filter((unit) => unit.fieldKey === fieldKey)
            .map((unit): readonly [string, ColumnFill] => [
              unit.columnKey,
              unit.fill,
            ]),
        ),
      ],
    ),
  );
};

/**
 * The schema the decide path validates against: each open column this node
 * grants REQUIRED is required. Its own `required` flag is kept as well, so a
 * column the template already requires stays required.
 */
export const projectNodeOpenColumnsRequired = (
  schema: FormDefinitionSchema,
  columnFillMap: NodeColumnFillMap,
): FormDefinitionSchema => ({
  ...schema,
  fields: schema.fields.map((field): FormFieldDefinition => {
    const columnFills = isTableFieldDefinition(field)
      ? columnFillMap.get(field.fieldKey)
      : undefined;

    if (!isTableFieldDefinition(field) || columnFills === undefined) {
      return field;
    }

    return {
      ...field,
      columns: field.columns.map((column): TableColumnDefinition =>
        columnFills.get(column.fieldKey) === 'REQUIRED' && !column.required
          ? { ...column, required: true }
          : column,
      ),
    };
  }),
});

const cellValue = (row: FormRow, columnKey: string): unknown =>
  row[columnKey] ?? null;

/**
 * The first applicant cell of `row` that differs from the stored row's, or
 * `null` when every applicant cell is the same. A missing cell counts as null.
 */
const readFirstMismatchedApplicantCell = (
  row: FormRow,
  storedRow: FormRow,
  openColumns: ReadonlySet<string>,
): string | null => {
  const applicant = readApplicantCells(row, openColumns);
  const storedApplicant = readApplicantCells(storedRow, openColumns);

  return (
    [
      ...new Set([...Object.keys(applicant), ...Object.keys(storedApplicant)]),
    ].find(
      (columnKey) =>
        computeStableValueFingerprint(cellValue(applicant, columnKey)) !==
        computeStableValueFingerprint(cellValue(storedApplicant, columnKey)),
    ) ?? null
  );
};

const rowsLocked = (fieldKey: string): ConflictException =>
  new ConflictException({
    code: APPROVER_FILL_ERROR_CODES.TABLE_ROWS_LOCKED,
    message: `Table ${fieldKey} has fixed rows at this step; an approver may only fill its open columns`,
  });

const settleTableRows = (
  fieldKey: string,
  rows: unknown,
  storedValue: unknown,
  openColumns: ReadonlySet<string>,
): unknown => {
  const storedRows: readonly unknown[] = Array.isArray(storedValue)
    ? storedValue
    : [];

  if (rows === null) {
    if (storedRows.length === 0) {
      return null;
    }

    throw rowsLocked(fieldKey);
  }

  // Not an array: the shape check in validation answers it with TYPE.
  if (!Array.isArray(rows)) {
    return rows;
  }

  if (rows.length !== storedRows.length) {
    throw rowsLocked(fieldKey);
  }

  return rows.map((row: unknown, index: number): unknown => {
    const storedRow = storedRows[index];

    if (!isFormRow(row) || !isFormRow(storedRow)) {
      throw rowsLocked(fieldKey);
    }

    const mismatch = readFirstMismatchedApplicantCell(
      row,
      storedRow,
      openColumns,
    );

    if (mismatch !== null) {
      // A row whose applicant cells match another stored row was moved, which
      // changes the row order. Reporting it as a changed cell would hide that.
      const movedElsewhere = storedRows.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          isFormRow(other) &&
          readFirstMismatchedApplicantCell(row, other, openColumns) === null,
      );

      if (movedElsewhere) {
        throw rowsLocked(fieldKey);
      }

      throw new ConflictException({
        code: APPROVER_FILL_ERROR_CODES.CELL_LOCKED,
        message: `Column ${mismatch} of table ${fieldKey} row ${index + 1} is not open to approvers`,
      });
    }

    // The applicant's cells come from the stored row, so a payload can only
    // change the open cells. Any other key the payload sent is dropped.
    return {
      ...readApplicantCells(storedRow, openColumns),
      ...Object.fromEntries(
        [...openColumns].map((columnKey) => [
          columnKey,
          cellValue(row, columnKey),
        ]),
      ),
    };
  });
};

/**
 * Settles an approver's payload against the stored form data, table by table
 * (ADR 27 §4(a)). The row count and order must match the stored rows, and each
 * row's applicant cells must match the stored row at that position. Only the
 * open cells are taken from the payload. Other fields pass through unchanged.
 */
export const settleColumnFillPayload = (
  payload: FormRow,
  stored: FormRow,
  columnFillMap: NodeColumnFillMap,
): FormRow =>
  Object.fromEntries(
    Object.entries(payload).map(
      ([fieldKey, value]): readonly [string, unknown] => {
        const columnFills = columnFillMap.get(fieldKey);

        return columnFills === undefined
          ? [fieldKey, value]
          : [
              fieldKey,
              settleTableRows(
                fieldKey,
                value,
                hasOwn(stored, fieldKey) ? stored[fieldKey] : undefined,
                new Set(columnFills.keys()),
              ),
            ];
      },
    ),
  );

/**
 * The schema narrowed to the open cells an approver fills that take a data
 * source (ADR 27 §4(b)): one table per column-mode table with at least one such
 * cell, keeping only those columns. A ROW_FIELD binding reads its value from
 * the same row of the form data, so the narrowed schema needs no other column.
 */
export const readOpenDataSourceCellSchema = (
  schema: FormDefinitionSchema,
  columnFillMap: NodeColumnFillMap,
): FormDefinitionSchema => ({
  ...schema,
  fields: schema.fields.flatMap((field): readonly FormFieldDefinition[] => {
    const columnFills = isTableFieldDefinition(field)
      ? columnFillMap.get(field.fieldKey)
      : undefined;

    if (!isTableFieldDefinition(field) || columnFills === undefined) {
      return [];
    }

    const columns = field.columns.flatMap(
      (column): readonly TableColumnDefinition[] =>
        columnFills.has(column.fieldKey) &&
        isFormDataSourceFieldDefinition(column)
          ? [column]
          : [],
    );

    return columns.length === 0 ? [] : [{ ...field, columns }];
  }),
});

/** Matches a cell snapshot key, `<tableKey>[<rowIndex>].<columnKey>`. */
const CELL_SNAPSHOT_KEY_PATTERN = /^([^[\].]+)\[\d+\]\.([^[\].]+)$/;

const readOpenCellKeys = (cellSchema: FormDefinitionSchema): ReadonlySet<string> =>
  new Set(
    cellSchema.fields.flatMap((field) =>
      isTableFieldDefinition(field)
        ? field.columns.map((column) => `${field.fieldKey}.${column.fieldKey}`)
        : [],
    ),
  );

const isOpenCellSnapshotKey = (
  key: string,
  openCellKeys: ReadonlySet<string>,
): boolean => {
  const match = CELL_SNAPSHOT_KEY_PATTERN.exec(key);

  return match !== null && openCellKeys.has(`${match[1]}.${match[2]}`);
};

/**
 * The snapshots without the cells of `cellSchema`: the open data-source cells
 * are re-resolved at decide time, so their stored snapshots must not survive
 * into the merge. Other rows, other columns and whole-field snapshots are kept.
 * This is not `readSnapshotWithoutFields`, which would also drop the applicant's
 * own cells of the same table.
 */
export const readSnapshotWithoutOpenCells = (
  snapshots: FormDataSourceValueSnapshots | null | undefined,
  cellSchema: FormDefinitionSchema,
): FormDataSourceValueSnapshots => {
  const openCellKeys = readOpenCellKeys(cellSchema);

  return Object.fromEntries(
    Object.entries(snapshots ?? {}).filter(
      ([key]) => !isOpenCellSnapshotKey(key, openCellKeys),
    ),
  );
};

/** Only the snapshots of the open cells of `cellSchema`, the complement of the above. */
export const readOpenCellSnapshots = (
  snapshots: FormDataSourceValueSnapshots,
  cellSchema: FormDefinitionSchema,
): FormDataSourceValueSnapshots => {
  const openCellKeys = readOpenCellKeys(cellSchema);

  return Object.fromEntries(
    Object.entries(snapshots).filter(([key]) =>
      isOpenCellSnapshotKey(key, openCellKeys),
    ),
  );
};
