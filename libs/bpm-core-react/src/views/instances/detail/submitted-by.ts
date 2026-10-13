/**
 * Who filed an approval instance on someone's behalf.
 *
 * `submittedByMemberId` is `null` on rows written before the column existed
 * and equals `initiatorMemberId` when the applicant submitted it themselves;
 * only a different, non-empty value means somebody else filed it. This is the
 * one place the detail page reads that rule.
 */

interface SubmittedByFields {
  readonly initiatorMemberId: string | null | undefined;
  readonly submittedByMemberId?: string | null;
}

interface NamedMember {
  readonly name: string;
}

export function readDistinctSubmitterMemberId({
  initiatorMemberId,
  submittedByMemberId,
}: SubmittedByFields): string | null {
  return submittedByMemberId && submittedByMemberId !== initiatorMemberId
    ? submittedByMemberId
    : null;
}

/**
 * 「由 {submitter} 代 {initiator} 送出」, or `null` when the applicant
 * submitted it themselves. A member whose profile did not load shows by id,
 * like every other member on the page.
 */
export function readSubmittedOnBehalfLabel(
  fields: SubmittedByFields,
  memberProfilesById: ReadonlyMap<string, NamedMember>,
): string | null {
  const submitterMemberId = readDistinctSubmitterMemberId(fields);

  if (!submitterMemberId || !fields.initiatorMemberId) {
    return null;
  }

  const readName = (memberId: string): string =>
    memberProfilesById.get(memberId)?.name ?? memberId;

  return `由 ${readName(submitterMemberId)} 代 ${readName(
    fields.initiatorMemberId,
  )} 送出`;
}
