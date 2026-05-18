import { ApiMemberResolver } from './api-member.resolver';
import type { Repository } from 'typeorm';
import { ApiTestMemberEntity } from './api-test-member.entity';

describe('ApiMemberResolver', () => {
  const resolver = new ApiMemberResolver(createRepository());

  it('resolves known DB-backed test members', async (): Promise<void> => {
    await expect(resolver.resolve('member-001')).resolves.toMatchObject({
      email: 'lin.ceo@example.internal',
      memberId: 'member-001',
      name: '林總經理',
    });
  });

  it('searches test members by email or member id', async (): Promise<void> => {
    await expect(resolver.search('cfo')).resolves.toEqual([
      expect.objectContaining({ memberId: 'member-101' }),
    ]);
  });
});

const TEST_MEMBERS: readonly ApiTestMemberEntity[] = [
  createMember('member-001', 'lin.ceo@example.internal', '林總經理'),
  createMember('member-101', 'chen.cfo@example.internal', '陳財務經理'),
];

function createMember(
  memberId: string,
  email: string,
  name: string,
): ApiTestMemberEntity {
  return {
    createdAt: new Date('2026-05-13T09:00:00.000Z'),
    customFields: {},
    email,
    memberId,
    name,
    passwordHash: '',
    permissions: [],
    roles: [],
    updatedAt: new Date('2026-05-13T09:00:00.000Z'),
  };
}

function createRepository(): Repository<ApiTestMemberEntity> {
  const repository = {
    createQueryBuilder: jest.fn(() => createQueryBuilder()),
    findOne: jest.fn(
      async ({
        where,
      }: {
        readonly where: { readonly memberId: string };
      }): Promise<ApiTestMemberEntity | null> =>
        TEST_MEMBERS.find((member) => member.memberId === where.memberId) ??
        null,
    ),
  };

  return repository as unknown as Repository<ApiTestMemberEntity>;
}

function createQueryBuilder(): {
  readonly getMany: () => Promise<readonly ApiTestMemberEntity[]>;
  readonly orderBy: () => ReturnType<typeof createQueryBuilder>;
  readonly orWhere: (
    sql: string,
    parameters: Readonly<Record<string, string>>,
  ) => ReturnType<typeof createQueryBuilder>;
  readonly where: (
    sql: string,
    parameters: Readonly<Record<string, string>>,
  ) => ReturnType<typeof createQueryBuilder>;
} {
  let searchText = '';
  const queryBuilder = {
    getMany: async (): Promise<readonly ApiTestMemberEntity[]> => {
      if (!searchText) {
        return TEST_MEMBERS;
      }

      const normalizedSearchText = searchText.split('%').join('');

      return TEST_MEMBERS.filter((member) =>
        [member.email, member.memberId, member.name].some((value) =>
          value.toLocaleLowerCase().includes(normalizedSearchText),
        ),
      );
    },
    orderBy: (): ReturnType<typeof createQueryBuilder> => queryBuilder,
    orWhere: (
      _sql: string,
      parameters: Readonly<Record<string, string>>,
    ): ReturnType<typeof createQueryBuilder> => {
      searchText = parameters.searchText ?? searchText;

      return queryBuilder;
    },
    where: (
      _sql: string,
      parameters: Readonly<Record<string, string>>,
    ): ReturnType<typeof createQueryBuilder> => {
      searchText = parameters.searchText ?? searchText;

      return queryBuilder;
    },
  };

  return queryBuilder;
}
