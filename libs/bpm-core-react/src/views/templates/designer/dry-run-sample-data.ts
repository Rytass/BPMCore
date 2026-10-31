import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isFormOptionFieldDefinition,
  isFormStaticOptionFieldDefinition,
  readFormFieldSelectionMode,
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

/**
 * Sample value of an org_unit field: a placeholder, since the dry run has no
 * way to know which organization a submitter would pick. The engine reports
 * 依表單欄位的組織主管 by field key, not by this value.
 */
export function readDryRunFormOrgUnitPlaceholder(fieldKey: string): string {
  return `formOrgUnit:${fieldKey}`;
}

function readDryRunSampleFieldValue(field: FormFieldDefinition): unknown {
  // `money` is numeric too: edge conditions compare it with a number literal
  // (`readConditionExpressionValue`), so a text sample fails CEL with
  // "lessOrEqualThan operation cannot be applied to (string, uint)".
  if (field.type === 'number' || field.type === 'money') {
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

  if (field.type === 'org_unit') {
    return readDryRunFormOrgUnitPlaceholder(field.fieldKey);
  }

  // The sample must have the shape a real submission stores: an array for any
  // multiple-selection field (checkbox, or select／autocomplete with
  // `mode: 'multiple'`, static or data-source options alike), a single value
  // otherwise. A string where an array belongs lets `form.x == "a"` pass the
  // dry run while the real case, holding `["a"]`, never matches.
  if (isFormOptionFieldDefinition(field)) {
    const firstOption = isFormStaticOptionFieldDefinition(field)
      ? field.options[0]?.value
      : undefined;

    if (readFormFieldSelectionMode(field) === 'multiple') {
      return firstOption === undefined ? [] : [firstOption];
    }

    if (isFormStaticOptionFieldDefinition(field)) {
      return firstOption ?? '';
    }
  }

  if (field.type === 'date') {
    return '2026-05-08';
  }

  if (field.type === 'datetime') {
    return '2026-05-08T09:00:00+08:00';
  }

  return field.placeholder ?? field.label;
}
