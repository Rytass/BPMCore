import { ApprovalInstanceEntity } from './approval-instance.entity';

// The person who pressed submit when that is not the applicant, else `null`.
// `submittedByMemberId` is NULL on rows written before the column existed and
// means "the initiator submitted it themselves", so this is the only place
// that interprets it.
export function readDistinctSubmitterMemberId(
  instance: Pick<
    ApprovalInstanceEntity,
    'initiatorMemberId' | 'submittedByMemberId'
  >,
): string | null {
  return instance.submittedByMemberId &&
    instance.submittedByMemberId !== instance.initiatorMemberId
    ? instance.submittedByMemberId
    : null;
}
