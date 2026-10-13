import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isFormStaticOptionFieldDefinition,
} from '@rytass/bpm-core-shared/form';

export function readDryRunSampleFormData(
  schema: FormDefinitionSchema | null,
): Readonly<Record<string, unknown>> {
  return (schema?.fields ?? []).reduce<Readonly<Record<string, unknown>>>(
    (formData, field) => ({
      ...formData,
      [field.fieldKey]: readDryRunSampleFieldValue(field),
    }),
    {},
  );
}

/**
 * Sample value of a member field: a placeholder the dry-run result labels as
 * "whoever this field names", never the dry-run initiator — a real submitter
 * picks someone else, and sampling the initiator would make a node that
 * excludes the initiator look skipped or stopped when it would not be.
 */
export function readDryRunFormMemberPlaceholder(fieldKey: string): string {
  return `formMember:${fieldKey}`;
}

function readDryRunSampleFieldValue(field: FormFieldDefinition): unknown {
  if (field.type === 'number') {
    return 1000;
  }

  if (field.type === 'boolean') {
    return true;
  }

  // A non-empty member placeholder, so a 依表單欄位指定 node resolves to
  // someone instead of failing on a free-text sample.
  if (field.type === 'member') {
    const placeholder = readDryRunFormMemberPlaceholder(field.fieldKey);

    return field.multiple ? [placeholder] : placeholder;
  }

  if (isFormStaticOptionFieldDefinition(field)) {
    return field.type === 'checkbox'
      ? field.options[0]
        ? [field.options[0].value]
        : []
      : (field.options[0]?.value ?? '');
  }

  if (field.type === 'date') {
    return '2026-05-08';
  }

  if (field.type === 'datetime') {
    return '2026-05-08T09:00:00+08:00';
  }

  return field.placeholder ?? field.label;
}
