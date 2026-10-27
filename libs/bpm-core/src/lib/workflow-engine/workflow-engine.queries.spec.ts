import { ModuleRef } from '@nestjs/core';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception.js';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import { IdentityService } from '../identity/identity.service';
import { WorkflowEngineQueries } from './workflow-engine.queries';
import {
  InactiveMemberOpenTasksRecord,
  WorkflowEngineService,
} from './workflow-engine.service';

describe('WorkflowEngineQueries.inactiveMembersWithOpenTasks', () => {
  it('lets the engine ask the identity service which holders are deactivated', async (): Promise<void> => {
    const inactive: MemberMetadata = {
      customFields: {},
      email: 'gone@example.internal',
      memberId: 'member-gone',
      name: '離職者',
    };
    const resolveInactiveMembers = jest.fn(
      (): Promise<readonly MemberMetadata[]> => Promise.resolve([inactive]),
    );
    const moduleRefGet = jest.fn(
      (): Pick<IdentityService, 'resolveInactiveMembers'> => ({
        resolveInactiveMembers,
      }),
    );
    const listInactiveMembersWithOpenTasks = jest.fn(
      async (
        resolve: (
          memberIds: readonly string[],
        ) => Promise<readonly MemberMetadata[]>,
      ): Promise<readonly InactiveMemberOpenTasksRecord[]> =>
        (await resolve(['member-gone'])).map(
          (member): InactiveMemberOpenTasksRecord => ({
            email: member.email,
            memberId: member.memberId,
            name: member.name,
            openTaskCount: 1,
          }),
        ),
    );
    const queries = new WorkflowEngineQueries(
      {
        listInactiveMembersWithOpenTasks,
      } as unknown as WorkflowEngineService,
      { get: moduleRefGet } as unknown as ModuleRef,
    );

    await expect(queries.inactiveMembersWithOpenTasks()).resolves.toEqual([
      {
        email: 'gone@example.internal',
        memberId: 'member-gone',
        name: '離職者',
        openTaskCount: 1,
      },
    ]);
    expect(moduleRefGet).toHaveBeenCalledWith(IdentityService, {
      strict: false,
    });
    expect(resolveInactiveMembers).toHaveBeenCalledWith(['member-gone']);
  });

  // IdentityModule is wired by the root; an engine without it answers empty
  // rather than failing the administrator's member screen.
  it('answers empty when no identity service is registered', async (): Promise<void> => {
    const listInactiveMembersWithOpenTasks = jest.fn();
    const queries = new WorkflowEngineQueries(
      {
        listInactiveMembersWithOpenTasks,
      } as unknown as WorkflowEngineService,
      {
        get: jest.fn((): never => {
          throw new UnknownElementException('IdentityService');
        }),
      } as unknown as ModuleRef,
    );

    await expect(queries.inactiveMembersWithOpenTasks()).resolves.toEqual([]);
    expect(listInactiveMembersWithOpenTasks).not.toHaveBeenCalled();
  });

  it('lets any other lookup failure through', async (): Promise<void> => {
    const queries = new WorkflowEngineQueries(
      {
        listInactiveMembersWithOpenTasks: jest.fn(),
      } as unknown as WorkflowEngineService,
      {
        get: jest.fn((): never => {
          throw new Error('IdentityService failed to construct');
        }),
      } as unknown as ModuleRef,
    );

    await expect(queries.inactiveMembersWithOpenTasks()).rejects.toThrow(
      'IdentityService failed to construct',
    );
  });
});
