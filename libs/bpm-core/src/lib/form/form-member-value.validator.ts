import {
  FormFieldDefinition,
  isFormMemberValue,
  isMemberFieldDefinition,
} from '@rytass/bpm-core-shared/form';

/**
 * Shape errors for the member fields among `fields` (the visible ones the
 * caller is about to accept). A member value is a non-empty string, or — when
 * the field is `multiple` — an array of non-empty strings; ids only, never
 * `{ id, name }`, because a `DYNAMIC_FORM` approver resolver reads the value as
 * member ids.
 *
 * Absent / `null` is "no value" and is left to the required check, which
 * already treats a blank string and an empty array as missing. The member ids
 * are deliberately not looked up in the directory here: the directory is the
 * host's, and an id that stops resolving is a resolver-time concern.
 *
 * Internal helper, not exported from the package index.
 */
export function readSubmittedMemberValueErrors(
  fields: readonly FormFieldDefinition[],
  formData: Readonly<Record<string, unknown>>,
): readonly string[] {
  return fields.filter(isMemberFieldDefinition).flatMap((field) => {
    const value = Object.prototype.hasOwnProperty.call(formData, field.fieldKey)
      ? formData[field.fieldKey]
      : undefined;

    if (typeof value === 'undefined' || value === null) {
      return [];
    }

    const multiple = field.multiple === true;

    return isFormMemberValue(value, multiple)
      ? []
      : [
          multiple
            ? `formData.${field.fieldKey} must be an array of member ids`
            : `formData.${field.fieldKey} must be a member id`,
        ];
  });
}
