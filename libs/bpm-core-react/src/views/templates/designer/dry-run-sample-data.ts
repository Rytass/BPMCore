import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isFormStaticOptionFieldDefinition,
} from '@rytass/bpm-core-shared/form';

export function readDryRunSampleFormData(
  schema: FormDefinitionSchema | null,
  initiatorMemberId: string,
): Readonly<Record<string, unknown>> {
  return (schema?.fields ?? []).reduce<Readonly<Record<string, unknown>>>(
    (formData, field) => ({
      ...formData,
      [field.fieldKey]: readDryRunSampleFieldValue(field, initiatorMemberId),
    }),
    {},
  );
}

function readDryRunSampleFieldValue(
  field: FormFieldDefinition,
  initiatorMemberId: string,
): unknown {
  if (field.type === 'number') {
    return 1000;
  }

  if (field.type === 'boolean') {
    return true;
  }

  // The dry-run initiator, so a 依表單欄位指定 node resolves to a real member
  // instead of failing on a free-text sample.
  if (field.type === 'member') {
    return field.multiple ? [initiatorMemberId] : initiatorMemberId;
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
