import type { Request, Response } from 'express';
import {
  API_SESSION_COOKIE_NAME,
  ApiSessionService,
} from './api-session.service';

describe('ApiSessionService', () => {
  const service = new ApiSessionService();

  it('logs in a demo member and writes a signed session cookie', (): void => {
    const response = createResponse();
    const member = service.login({
      identifier: 'lin.ceo@example.internal',
      password: 'demo',
      response,
    });

    expect(member).toMatchObject({
      email: 'lin.ceo@example.internal',
      memberId: 'member-001',
      name: '林執行長',
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

  it('rejects invalid credentials', (): void => {
    expect(() =>
      service.login({
        identifier: 'lin.ceo@example.internal',
        password: 'wrong',
        response: createResponse(),
      }),
    ).toThrow('Invalid BPM API credentials');
  });

  it('reads BPM auth context from a valid session cookie', (): void => {
    const response = createResponse();

    service.login({
      identifier: 'member-101',
      password: 'demo',
      response,
    });

    const token = readWrittenSessionToken(response);
    const context = service.readBPMAuthContextFromRequest(
      createRequestWithSession(token),
    );

    expect(context).toEqual({
      memberId: 'member-101',
      metadata: {
        email: 'chen.cfo@example.internal',
        memberId: 'member-101',
        name: '陳財務長',
        positionId: 'VP',
        primaryOrgUnitId: 'FIN',
      },
      permissions: ['task.decide', 'task.transfer', 'instance.read'],
      roles: ['APPROVER'],
    });
  });

  it('ignores tampered session cookies', (): void => {
    expect(
      service.readAuthenticatedMemberFromRequest(
        createRequestWithSession('tampered.token'),
      ),
    ).toBeNull();
  });
});

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
