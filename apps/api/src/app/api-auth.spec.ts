import { Request } from 'express';
import { buildApiBPMAuthContextFromRequest } from './api-auth';

describe('buildApiBPMAuthContextFromRequest', () => {
  it('returns null when the host request has no authenticated member', (): void => {
    expect(buildApiBPMAuthContextFromRequest(readRequest({}))).toBeNull();
  });

  it('builds BPM auth context from host headers', (): void => {
    expect(
      buildApiBPMAuthContextFromRequest(
        readRequest({
          'x-bpm-member-email': 'demo@example.internal',
          'x-bpm-member-id': 'member-demo',
          'x-bpm-member-name': 'Demo User',
          'x-bpm-permissions': 'template.publish,task.decide',
          'x-bpm-roles': 'BPM_ADMIN,APPROVER',
        }),
      ),
    ).toEqual({
      memberId: 'member-demo',
      metadata: {
        email: 'demo@example.internal',
        memberId: 'member-demo',
        name: 'Demo User',
      },
      permissions: ['template.publish', 'task.decide'],
      roles: ['BPM_ADMIN', 'APPROVER'],
    });
  });
});

function readRequest(headers: Readonly<Record<string, string>>): Request {
  return { headers } as unknown as Request;
}
