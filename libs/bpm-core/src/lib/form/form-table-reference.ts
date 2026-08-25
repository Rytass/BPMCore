import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';

/**
 * Shared detection of "this condition addresses the inside of a table".
 *
 * Both halves of the ban live behind this module: the form schema's own
 * `visibleWhen` / `requiredWhen` / `readonlyWhen` (linted in
 * `form-schema.validator.ts`) and the workflow edge structured condition plus
 * CEL expressions (linted at template publish). Keeping one implementation is
 * the same reasoning ADR 14 §3.7 applies to the DataSource validators — two
 * copies of a rule drift, and the drift only shows up at publish time.
 *
 * Deliberately not exported from the package index; this is an internal lint
 * helper, not public API.
 */
export function readTableFieldKeys(
  schema: FormDefinitionSchema | null | undefined,
): ReadonlySet<string> {
  return new Set(
    (schema?.fields ?? [])
      .filter((field) => field?.type === 'table')
      .map((field) => field.fieldKey)
      .filter((fieldKey): fieldKey is string => typeof fieldKey === 'string'),
  );
}

/**
 * True when a CEL expression steps into a table value — `form.items.qty`,
 * `form.items[0].qty` or the bracket spelling of either. Referencing the table
 * itself (`size(form.items)`) stays legal; that is what the IS_FILLED /
 * IS_EMPTY operators compile to (ADR 16 §3.8).
 */
export function referencesTableInternals(
  expression: string,
  tableKey: string,
): boolean {
  const escapedKey = escapeRegExpLiteral(tableKey);

  return [
    new RegExp(`form\\.${escapedKey}\\s*(?:\\.|\\[)`, 'u'),
    new RegExp(`form\\[\\s*["']${escapedKey}["']\\s*\\]\\s*(?:\\.|\\[)`, 'u'),
  ].some((pattern) => pattern.test(expression));
}

/**
 * True when a structured condition's `conditionFieldKey` names a path inside a
 * table (`items.qty`, `items[0].qty`) rather than a top-level field. V1 only
 * offers IS_FILLED / IS_EMPTY on the table itself.
 */
export function isTableInternalFieldKey(
  fieldKey: string,
  tableFieldKeys: ReadonlySet<string>,
): boolean {
  return [...tableFieldKeys].some(
    (tableKey) =>
      fieldKey.startsWith(`${tableKey}.`) || fieldKey.startsWith(`${tableKey}[`),
  );
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
