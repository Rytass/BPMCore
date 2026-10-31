import { isUUID } from 'class-validator';
import {
  FormFieldDefinition,
  isFormOrgUnitValue,
  isOrgUnitFieldDefinition,
} from '@rytass/bpm-core-shared/form';

/**
 * Shape errors for the org_unit fields among `fields` (the ones the caller is
 * about to accept). An org unit value is one organization unit id: a non-blank
 * string that is a uuid — the same rule the engine applies before it looks the
 * unit up for a `FORM_ORG_UNIT_MANAGER` node, so a bad value is refused here
 * instead of surfacing as a database error when the node starts.
 *
 * Absent / `null` is "no value" and is left to the required check. Whether the
 * unit exists is deliberately not looked up: the organization directory is the
 * host's, and a unit that stops resolving is a resolver-time concern.
 *
 * Internal helper, not exported from the package index.
 */
export function readSubmittedOrgUnitValueErrors(
  fields: readonly FormFieldDefinition[],
  formData: Readonly<Record<string, unknown>>,
): readonly string[] {
  return fields.filter(isOrgUnitFieldDefinition).flatMap((field) => {
    const value = Object.prototype.hasOwnProperty.call(formData, field.fieldKey)
      ? formData[field.fieldKey]
      : undefined;

    if (typeof value === 'undefined' || value === null) {
      return [];
    }

    return typeof value === 'string' &&
      isFormOrgUnitValue(value) &&
      isUUID(value.trim())
      ? []
      : [`formData.${field.fieldKey} must be an organization unit id`];
  });
}
