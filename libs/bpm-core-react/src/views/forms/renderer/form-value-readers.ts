import type { FormFieldValue } from '@rytass/bpm-core-shared/form';

/**
 * A multi-value field's ids or option values, or `[]` for anything else.
 * A table value is also an array, so the element check is what separates a
 * multi-select or `file_upload` value from table rows.
 */
export function readStringArrayValue(
  value: FormFieldValue | undefined,
): readonly string[] {
  return Array.isArray(value) &&
    value.every((item): boolean => typeof item === 'string')
    ? (value as readonly string[])
    : [];
}
