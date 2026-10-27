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

  it('leaves searchPaged undefined when the directory does not implement searchMembersPaged', (): void => {
    const resolver = new BPMMemberBaseResolverAdapter<TestMemberBaseMember>({
      resolveMember: (): Promise<TestMemberBaseMember | null> =>
        Promise.resolve(null),
    });

    expect(resolver.searchPaged).toBeUndefined();
  });

  it('delegates searchPaged to the directory and maps items to member metadata', async (): Promise<void> => {
    const members = [
      createMember('member-001'),
      createMember('member-002'),
      createMember('member-003'),
    ];
    const resolver = new BPMMemberBaseResolverAdapter<TestMemberBaseMember>({
      resolveMember: (memberId): Promise<TestMemberBaseMember | null> =>
        Promise.resolve(
          members.find((member) => member.id === memberId) ?? null,
        ),
      searchMembersPaged: (_searchText, options) => {
        const offset = (options.page - 1) * options.pageSize;

        return Promise.resolve({
          items: members.slice(offset, offset + options.pageSize),
          total: members.length,
        });
      },
    });

    await expect(
      resolver.searchPaged?.('', { page: 2, pageSize: 2 }),
    ).resolves.toEqual({
      items: [
        {
          customFields: {},
          email: 'member-003@example.com',
          memberId: 'member-003',
          name: 'Member member-003',
        },
      ],
      total: 3,
    });
  });
});

describe('member-base adapter resolveInactive', () => {
  it('leaves resolveInactive undefined when the directory does not implement resolveInactiveMembers', (): void => {
    const resolver = new BPMMemberBaseResolverAdapter<TestMemberBaseMember>({
      resolveMember: (): Promise<TestMemberBaseMember | null> =>
        Promise.resolve(null),
    });

    expect(resolver.resolveInactive).toBeUndefined();
  });

  it('delegates resolveInactive to the directory and maps members to member metadata', async (): Promise<void> => {
    const resolveInactiveMembers = jest.fn(
      (
        memberIds: readonly string[],
      ): Promise<readonly TestMemberBaseMember[]> =>
        Promise.resolve(memberIds.slice(1).map(createMember)),
    );
    const resolver = new BPMMemberBaseResolverAdapter<TestMemberBaseMember>({
      resolveInactiveMembers,
      resolveMember: (): Promise<TestMemberBaseMember | null> =>
        Promise.resolve(null),
    });

    await expect(
      resolver.resolveInactive?.(['member-001', 'member-002']),
    ).resolves.toEqual([
      {
        customFields: {},
        email: 'member-002@example.com',
        memberId: 'member-002',
        name: 'Member member-002',
      },
    ]);
    expect(resolveInactiveMembers).toHaveBeenCalledWith([
      'member-001',
      'member-002',
    ]);
  });

  it('calls resolveInactiveMembers on a class-based directory with its this', async (): Promise<void> => {
    class Directory {
      private readonly gone: readonly string[] = ['member-gone'];

      resolveMember(): Promise<TestMemberBaseMember | null> {
        return Promise.resolve(null);
      }

      resolveInactiveMembers(
        memberIds: readonly string[],
      ): Promise<readonly TestMemberBaseMember[]> {
        return Promise.resolve(
          memberIds
            .filter((memberId): boolean => this.gone.includes(memberId))
            .map(createMember),
        );
      }
    }
    const resolver = new BPMMemberBaseResolverAdapter<TestMemberBaseMember>(
      new Directory(),
    );

    await expect(
      resolver.resolveInactive?.(['member-gone', 'member-here']),
    ).resolves.toEqual([expect.objectContaining({ memberId: 'member-gone' })]);
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
