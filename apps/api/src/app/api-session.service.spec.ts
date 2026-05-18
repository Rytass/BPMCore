import type { Request, Response } from 'express';
import type { Repository } from 'typeorm';
import { createApiTestMemberPasswordHash } from './api-simulation-members';
import {
  API_SESSION_COOKIE_NAME,
  ApiSessionService,
} from './api-session.service';
import { ApiTestMemberEntity } from './api-test-member.entity';

describe('ApiSessionService', () => {
  const service = new ApiSessionService(createRepository());

  it('logs in a DB-backed test member and writes a signed session cookie', async (): Promise<void> => {
    const response = createResponse();
    const member = await service.login({
      identifier: 'lin.ceo@example.internal',
      password: 'demo',
      response,
    });

    expect(member).toMatchObject({
      email: 'lin.ceo@example.internal',
      memberId: 'member-001',
      name: '林總經理',
      roles: ['BPM_ADMIN'],
    });
    expect(response.cookie).toHaveBeenCalledWith(
      API_SESSION_COOKIE_NAME,
      expect.stringContaining('.'),
      expect.objectContaining({
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      }),
    );
  });

  it('rejects invalid credentials', async (): Promise<void> => {
    await expect(
      service.login({
        identifier: 'lin.ceo@example.internal',
        password: 'wrong',
        response: createResponse(),
      }),
    ).rejects.toThrow('Invalid BPM API credentials');
  });

  it('reads BPM auth context from a valid session cookie', async (): Promise<void> => {
    const response = createResponse();

    await service.login({
      identifier: 'member-101',
      password: 'demo',
      response,
    });

    const token = readWrittenSessionToken(response);
    const context = await service.readBPMAuthContextFromRequest(
      createRequestWithSession(token),
    );

    expect(context).toEqual({
      memberId: 'member-101',
      metadata: {
        customFields: {
          employeeNo: 'EMP-101',
        },
        email: 'chen.cfo@example.internal',
        memberId: 'member-101',
        name: '陳財務經理',
      },
      permissions: ['task.decide', 'task.transfer', 'instance.read'],
      roles: ['APPROVER'],
    });
  });

  it('ignores tampered session cookies', async (): Promise<void> => {
    await expect(
      service.readAuthenticatedMemberFromRequest(
        createRequestWithSession('tampered.token'),
      ),
    ).resolves.toBeNull();
  });
});

const TEST_MEMBERS: readonly ApiTestMemberEntity[] = [
  createMember({
    email: 'lin.ceo@example.internal',
    memberId: 'member-001',
    name: '林總經理',
    permissions: ['bpm:*'],
    roles: ['BPM_ADMIN'],
  }),
  createMember({
    email: 'chen.cfo@example.internal',
    memberId: 'member-101',
    name: '陳財務經理',
    permissions: ['task.decide', 'task.transfer', 'instance.read'],
    roles: ['APPROVER'],
  }),
];

function createMember(input: {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}): ApiTestMemberEntity {
  return {
    createdAt: new Date('2026-05-13T09:00:00.000Z'),
    customFields: { employeeNo: input.memberId.replace('member-', 'EMP-') },
    email: input.email,
    memberId: input.memberId,
    name: input.name,
    passwordHash: createApiTestMemberPasswordHash('demo'),
    permissions: input.permissions,
    roles: input.roles,
    updatedAt: new Date('2026-05-13T09:00:00.000Z'),
  };
}

function createRepository(): Repository<ApiTestMemberEntity> {
  const repository = {
    createQueryBuilder: jest.fn(() => createQueryBuilder()),
    find: jest.fn(async () => TEST_MEMBERS),
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
  readonly getOne: () => Promise<ApiTestMemberEntity | null>;
  readonly orWhere: (
    sql: string,
    parameters: Readonly<Record<string, string>>,
  ) => ReturnType<typeof createQueryBuilder>;
  readonly where: (
    sql: string,
    parameters: Readonly<Record<string, string>>,
  ) => ReturnType<typeof createQueryBuilder>;
} {
  let identifier = '';
  const queryBuilder = {
    getOne: async (): Promise<ApiTestMemberEntity | null> =>
      TEST_MEMBERS.find(
        (member) =>
          member.memberId.toLocaleLowerCase() === identifier ||
          member.email.toLocaleLowerCase() === identifier,
      ) ?? null,
    orWhere: (
      _sql: string,
      parameters: Readonly<Record<string, string>>,
    ): ReturnType<typeof createQueryBuilder> => {
      identifier = parameters.identifier ?? identifier;

      return queryBuilder;
    },
    where: (
      _sql: string,
      parameters: Readonly<Record<string, string>>,
    ): ReturnType<typeof createQueryBuilder> => {
      identifier = parameters.identifier ?? identifier;

      return queryBuilder;
    },
  };

  return queryBuilder;
}

function createResponse(): Response {
  return {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;
}

function readWrittenSessionToken(response: Response): string {
  const cookieMock = response.cookie as unknown as jest.MockedFunction<
    (name: string, value: string) => Response
  >;
  const [, token] = cookieMock.mock.calls[0] ?? [];

  if (!token) {
    throw new Error('Session cookie was not written');
  }

  return token;
}

function createRequestWithSession(token: string): Request {
  return {
    headers: {
      cookie: `${API_SESSION_COOKIE_NAME}=${token}`,
    },
  } as unknown as Request;
}
