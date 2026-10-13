import type {
  ActivityLogRecord,
  MemberProfileRecord,
} from '@rytass/bpm-core-client/workflow';
import { resolveMemberProfiles } from '@rytass/bpm-core-client/workflow';

import { readMemberProfilesForTimeline } from './container-helpers';

jest.mock('@rytass/bpm-core-client/workflow', () => ({
  listTaskDecisions: jest.fn(),
  resolveMemberProfiles: jest.fn(),
}));

describe('readMemberProfilesForTimeline', () => {
  it('loads profiles for member ids that only appear in sequential payloads', async () => {
    const resolve = jest.mocked(resolveMemberProfiles);

    resolve.mockResolvedValue([] as readonly MemberProfileRecord[]);

    await readMemberProfilesForTimeline({
      activityLogs: [
        {
          actorMemberId: null,
          eventType: 'TASK_CREATED',
          payloadJson: JSON.stringify({
            sequentialCandidateMemberIds: ['member-a', 'member-b'],
          }),
        },
        {
          actorMemberId: 'member-actor',
          eventType: 'TASK_CANDIDATE_ACTIVATED',
          payloadJson: JSON.stringify({
            candidateMemberId: 'member-b',
            previousMemberId: 'member-a',
          }),
        },
      ] as unknown as readonly ActivityLogRecord[],
      tasks: [],
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect([...(resolve.mock.calls[0][0] as readonly string[])].sort()).toEqual(
      ['member-a', 'member-actor', 'member-b'],
    );
  });

  it('loads the applicant and the member who filed on their behalf for the header', async () => {
    const resolve = jest.mocked(resolveMemberProfiles);

    resolve.mockClear();
    resolve.mockResolvedValue([] as readonly MemberProfileRecord[]);

    await readMemberProfilesForTimeline({
      activityLogs: [],
      instance: {
        initiatorMemberId: 'member-applicant',
        submittedByMemberId: 'member-assistant',
      },
      tasks: [],
    });

    expect([...(resolve.mock.calls[0][0] as readonly string[])].sort()).toEqual(
      ['member-applicant', 'member-assistant'],
    );
  });
});
