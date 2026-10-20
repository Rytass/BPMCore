import {
  omitFormDataKeys,
  readApproverFilledFieldKeys,
  type WorkflowDefinition,
} from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { WorkflowFormData } from '@rytass/bpm-core-client/workflow';

/**
 * The form as the applicant sees it: without the fields some approver fills in.
 * The server drops those keys from a submission, so rendering one would swallow
 * what the applicant types, and a `minRows` or `required` on it would block a
 * launch nobody can complete. Returns an equal schema when nothing is
 * approver-filled; never mutates its input.
 */
export function readApplicantFormSchema(
  schema: FormDefinitionSchema,
  definition: WorkflowDefinition,
): FormDefinitionSchema {
  const approverFilledKeys = readApproverFilledFieldKeys(definition);

  return {
    ...schema,
    fields: schema.fields.filter(
      (field) => !approverFilledKeys.has(field.fieldKey),
    ),
  };
}

/** The payload the applicant may send: `values` without approver-filled keys. */
export function readApplicantSubmission(
  values: WorkflowFormData,
  definition: WorkflowDefinition,
): WorkflowFormData {
  // Dropping keys cannot change a remaining value's type, which is all the
  // shared helper's `unknown` return forgets.
  return omitFormDataKeys(
    values,
    readApproverFilledFieldKeys(definition),
  ) as WorkflowFormData;
}
