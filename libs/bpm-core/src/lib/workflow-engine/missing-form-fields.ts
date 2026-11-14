import { FormDefinitionSchema } from '@rytass/bpm-core-shared';

/**
 * The form data an expression reads when the host turns on
 * `expressionMissingFormFieldsAsNull` (ADR 27 §3): every top-level field of
 * the schema that the data has no key for is added, as `[]` for a table and
 * `null` for anything else. A key that is present is never touched, and the
 * columns inside table rows are not filled.
 *
 * The result is a copy used for evaluation only; it is never written back to
 * `form_data`.
 */
export function fillMissingFormFields(
  formData: Readonly<Record<string, unknown>>,
  schema: FormDefinitionSchema,
): Readonly<Record<string, unknown>> {
  const missing = schema.fields.filter(
    (field): boolean =>
      !Object.prototype.hasOwnProperty.call(formData, field.fieldKey),
  );

  if (missing.length === 0) {
    return formData;
  }

  return {
    ...Object.fromEntries(
      missing.map((field): readonly [string, unknown] => [
        field.fieldKey,
        field.type === 'table' ? [] : null,
      ]),
    ),
    ...formData,
  };
}
