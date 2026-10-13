import {
  readDistinctSubmitterMemberId,
  readSubmittedOnBehalfLabel,
} from './submitted-by';

const PROFILES = new Map([
  ['member-applicant', { name: '陳申請' }],
  ['member-assistant', { name: '王助理' }],
]);

describe('readDistinctSubmitterMemberId', () => {
  it('is null when no submitter is recorded', () => {
    expect(
      readDistinctSubmitterMemberId({
        initiatorMemberId: 'member-applicant',
        submittedByMemberId: null,
      }),
    ).toBeNull();
    expect(
      readDistinctSubmitterMemberId({ initiatorMemberId: 'member-applicant' }),
    ).toBeNull();
  });

  it('is null when the applicant submitted it themselves', () => {
    expect(
      readDistinctSubmitterMemberId({
        initiatorMemberId: 'member-applicant',
        submittedByMemberId: 'member-applicant',
      }),
    ).toBeNull();
  });

  it('is the submitter when somebody else filed it', () => {
    expect(
      readDistinctSubmitterMemberId({
        initiatorMemberId: 'member-applicant',
        submittedByMemberId: 'member-assistant',
      }),
    ).toBe('member-assistant');
  });
});

describe('readSubmittedOnBehalfLabel', () => {
  it('names both people when somebody filed on the applicant behalf', () => {
    expect(
      readSubmittedOnBehalfLabel(
        {
          initiatorMemberId: 'member-applicant',
          submittedByMemberId: 'member-assistant',
        },
        PROFILES,
      ),
    ).toBe('由 王助理 代 陳申請 送出');
  });

  it('falls back to the member id for a profile that did not load', () => {
    expect(
      readSubmittedOnBehalfLabel(
        {
          initiatorMemberId: 'member-applicant',
          submittedByMemberId: 'member-unknown',
        },
        PROFILES,
      ),
    ).toBe('由 member-unknown 代 陳申請 送出');
  });

  it('says nothing when the applicant submitted it themselves', () => {
    expect(
      readSubmittedOnBehalfLabel(
        {
          initiatorMemberId: 'member-applicant',
          submittedByMemberId: 'member-applicant',
        },
        PROFILES,
      ),
    ).toBeNull();
    expect(
      readSubmittedOnBehalfLabel(
        { initiatorMemberId: 'member-applicant', submittedByMemberId: null },
        PROFILES,
      ),
    ).toBeNull();
  });
});
