import { Request } from 'express';
import { buildApiBPMAuthContextFromExecutionContext } from './api-auth';

describe('buildApiBPMAuthContextFromExecutionContext', () => {
  it('returns null when the host request only has BPM impersonation headers', (): void => {
    expect(
      buildApiBPMAuthContextFromExecutionContext(
        readExecutionContext(
          readRequest({
            'x-bpm-member-email': 'demo@example.internal',
            'x-bpm-member-id': 'member-demo',
            'x-bpm-member-name': 'Demo User',
            'x-bpm-permissions': 'template.publish,task.decide',
            'x-bpm-roles': 'BPM_ADMIN,APPROVER',
          }),
        ),
      ),
    ).toBeNull();
  });

  it('returns the BPM auth context created by the GraphQL session context', (): void => {
    const bpmAuthContext = {
      memberId: 'member-session',
      metadata: {
        email: 'session@example.internal',
      },
      permissions: ['task.decide'],
      roles: ['APPROVER'],
    };

    expect(
      buildApiBPMAuthContextFromExecutionContext(
        readExecutionContext(readRequest({}), bpmAuthContext),
      ),
    ).toBe(bpmAuthContext);
  });
});

function readRequest(headers: Readonly<Record<string, string>>): Request {
  return { headers } as unknown as Request;
}

function readExecutionContext(
  request: Request,
  bpmAuthContext: unknown = null,
): Parameters<typeof buildApiBPMAuthContextFromExecutionContext>[0] {
  return {
    getArgByIndex: (index: number): unknown =>
      index === 2
        ? {
            bpmAuthContext,
            req: request,
          }
        : undefined,
    getArgs: (): readonly unknown[] => [
      undefined,
      undefined,
      {
        bpmAuthContext,
        req: request,
      },
      undefined,
    ],
    getClass: (): typeof TestResolver => TestResolver,
    getHandler: (): typeof testHandler => testHandler,
    getType: (): string => 'graphql',
    switchToHttp: (): never => {
      throw new Error('not implemented');
    },
    switchToRpc: (): never => {
      throw new Error('not implemented');
    },
    switchToWs: (): never => {
      throw new Error('not implemented');
    },
  } as Parameters<typeof buildApiBPMAuthContextFromExecutionContext>[0];
}

class TestResolver {}

function testHandler(): string {
  return 'test-handler';
}
