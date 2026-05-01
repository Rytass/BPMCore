import { Injectable } from '@nestjs/common';
import { MemberMetadata } from '@bpm/shared';
import { MemberResolver } from './member-resolver.interface';

const MOCK_MEMBERS: readonly MemberMetadata[] = [
  {
    customFields: { costCenter: 'EXEC', location: 'Taipei' },
    email: 'lin.ceo@example.internal',
    memberId: 'member-001',
    name: '林執行長',
    positionId: null,
    primaryOrgUnitId: null,
  },
  {
    customFields: { costCenter: 'FIN', location: 'Taipei' },
    email: 'chen.manager@example.internal',
    memberId: 'member-101',
    name: '陳財務主管',
    positionId: null,
    primaryOrgUnitId: null,
  },
  {
    customFields: { costCenter: 'FIN', location: 'Taipei' },
    email: 'wu.staff@example.internal',
    memberId: 'member-102',
    name: '吳財務專員',
    positionId: null,
    primaryOrgUnitId: null,
  },
];

@Injectable()
export class LocalMockMemberResolver implements MemberResolver {
  async resolve(memberId: string): Promise<MemberMetadata> {
    const found = MOCK_MEMBERS.find((member) => member.memberId === memberId);

    return (
      found ?? {
        customFields: {},
        email: `${memberId}@example.internal`,
        memberId,
        name: memberId,
        positionId: null,
        primaryOrgUnitId: null,
      }
    );
  }

  async resolveMany(
    memberIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberMetadata>> {
    const entries = await Promise.all(
      memberIds.map(async (memberId): Promise<readonly [string, MemberMetadata]> => [
        memberId,
        await this.resolve(memberId),
      ]),
    );

    return new Map(entries);
  }
}
