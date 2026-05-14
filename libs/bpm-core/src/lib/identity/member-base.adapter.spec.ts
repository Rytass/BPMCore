import {
  BPMMemberBaseResolverAdapter,
  createBPMAuthContextFromMemberBaseMember,
} from './member-base.adapter';

interface TestMemberBaseMember {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

describe('member-base adapter', () => {
  it('creates BPM auth context from a host member-base member', (): void => {
    const context = createBPMAuthContextFromMemberBaseMember(
      createMember('member-001'),
      {
        readCustomFields: (member): Readonly<Record<string, unknown>> => ({
          source: 'member-base',
          tenantMemberId: member.id,
        }),
        readPermissions: (member): readonly string[] => member.permissions,
        readRoles: (member): readonly string[] => member.roles,
      },
    );

    expect(context).toEqual({
      memberId: 'member-001',
      metadata: {
        source: 'member-base',
        tenantMemberId: 'member-001',
      },
      permissions: ['bpm:approve'],
      roles: ['approver'],
    });
  });

  it('adapts member-base lookup and search to BPM member metadata', async (): Promise<void> => {
    const members = [createMember('member-001'), createMember('member-002')];
    const resolver = new BPMMemberBaseResolverAdapter<TestMemberBaseMember>({
      resolveMember: (memberId): Promise<TestMemberBaseMember | null> =>
        Promise.resolve(
          members.find((member) => member.id === memberId) ?? null,
        ),
      searchMembers: (searchText): Promise<readonly TestMemberBaseMember[]> =>
        Promise.resolve(
          members.filter((member) => member.email.includes(searchText)),
        ),
    });

    await expect(resolver.resolve('member-001')).resolves.toEqual({
      customFields: {},
      email: 'member-001@example.com',
      memberId: 'member-001',
      name: 'Member member-001',
    });
    await expect(resolver.search?.('member-002')).resolves.toEqual([
      {
        customFields: {},
        email: 'member-002@example.com',
        memberId: 'member-002',
        name: 'Member member-002',
      },
    ]);
  });
});

function createMember(id: string): TestMemberBaseMember {
  return {
    email: `${id}@example.com`,
    id,
    name: `Member ${id}`,
    permissions: ['bpm:approve'],
    roles: ['approver'],
  };
}
