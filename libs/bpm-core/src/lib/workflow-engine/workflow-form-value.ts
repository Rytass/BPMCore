/*
 * Form-value reads shared by the structured condition evaluator and the
 * engine's structured fallback. Internal to the workflow engine: this file is
 * deliberately not re-exported from `index.ts`.
 */

/**
 * A form value by key, own properties only: an absent key named like an
 * inherited member (`constructor`, `toString`) reads as `undefined`, not as a
 * function.
 */
export function readOwnFormValue(
  formData: Readonly<Record<string, unknown>>,
  fieldKey: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(formData, fieldKey)
    ? formData[fieldKey]
    : undefined;
}

/**
 * Whether a form value counts as unfilled: absent, `null`, `""`, whitespace
 * only or an empty list. The same set `IS_EMPTY` reports.
 */
export function isEmptyWorkflowValue(value: unknown): boolean {
  if (value === null || typeof value === 'undefined') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return typeof value === 'string' ? value.trim() === '' : false;
}
