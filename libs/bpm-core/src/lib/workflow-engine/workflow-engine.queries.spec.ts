import { ModuleRef } from '@nestjs/core';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception.js';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import { IdentityService } from '../identity/identity.service';
import { WorkflowEngineQueries } from './workflow-engine.queries';
import { StuckApprovalInstanceKindEnum } from './workflow-engine.enums';
import {
  InactiveMemberOpenTasksRecord,
  StuckApprovalInstanceRecord,
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

describe('WorkflowEngineQueries.stuckApprovalInstances', () => {
  it('hands back what the engine lists, untouched', async (): Promise<void> => {
    const rows: readonly StuckApprovalInstanceRecord[] = [
      {
        automatic: null,
        failedActorMemberId: 'member-001',
        failedAt: new Date('2026-05-04T09:00:00.000Z'),
        initiatorMemberId: 'member-002',
        instanceId: 'instance-1',
        instanceTitle: '費用申請',
        kind: StuckApprovalInstanceKindEnum.DECISION,
        message: '簽核節點「下一關」 找不到簽核人',
        nodeId: 'task_finance',
        nodeLabel: '財務簽核',
        pendingActorMemberIds: ['member-001'],
        taskId: 'task-1',
        templateId: 'template-1',
        templateName: '費用申請',
      },
    ];
    const listStuckApprovalInstances = jest.fn(
      (): Promise<readonly StuckApprovalInstanceRecord[]> =>
        Promise.resolve(rows),
    );
    const queries = new WorkflowEngineQueries(
      { listStuckApprovalInstances } as unknown as WorkflowEngineService,
      {} as unknown as ModuleRef,
    );

    await expect(queries.stuckApprovalInstances(2, 50)).resolves.toBe(rows);
    expect(listStuckApprovalInstances).toHaveBeenCalledWith({
      page: 2,
      pageSize: 50,
    });

    // Absent paging is left to the engine's defaults, not sent as null.
    await queries.stuckApprovalInstances(null, null);
    expect(listStuckApprovalInstances).toHaveBeenLastCalledWith({
      page: undefined,
      pageSize: undefined,
    });
  });

  it('hands back the engine count', async (): Promise<void> => {
    const countStuckApprovalInstances = jest.fn(
      (): Promise<number> => Promise.resolve(7),
    );
    const queries = new WorkflowEngineQueries(
      { countStuckApprovalInstances } as unknown as WorkflowEngineService,
      {} as unknown as ModuleRef,
    );

    await expect(queries.stuckApprovalInstanceCount()).resolves.toBe(7);
  });
});
