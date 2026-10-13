import { readDistinctSubmitterMemberId } from './instance-submitter';

describe('readDistinctSubmitterMemberId', () => {
  it('treats a missing submitter as the applicant submitting themselves', () => {
    expect(
      readDistinctSubmitterMemberId({
        initiatorMemberId: 'member-applicant',
        submittedByMemberId: null,
      }),
    ).toBeNull();
  });

  it('treats a submitter equal to the applicant as the applicant submitting themselves', () => {
    expect(
      readDistinctSubmitterMemberId({
        initiatorMemberId: 'member-applicant',
        submittedByMemberId: 'member-applicant',
      }),
    ).toBeNull();
  });

  it('returns the submitter when someone else filed the document', () => {
    expect(
      readDistinctSubmitterMemberId({
        initiatorMemberId: 'member-applicant',
        submittedByMemberId: 'member-assistant',
      }),
    ).toBe('member-assistant');
  });
});
