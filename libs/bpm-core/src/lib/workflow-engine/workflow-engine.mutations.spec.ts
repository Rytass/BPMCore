import { BadRequestException } from '@nestjs/common';
import { BPMAuthContext, listBPMResolverHandlers } from '../bpm-auth';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { DecideTaskInput } from './dto/decide-task.input';
import { ResubmitApprovalInstanceInput } from './dto/resubmit-approval-instance.input';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { TaskDecisionActionEnum } from './workflow-engine.enums';
import { WorkflowEngineMutations } from './workflow-engine.mutations';
// Loaded for its decorators, which register the query's access level.
import './workflow-engine.queries';
import { WorkflowEngineService } from './workflow-engine.service';

describe('WorkflowEngineMutations', () => {
  it('never lets a GraphQL submit set the business key', async (): Promise<void> => {
    const submitApprovalInstance = jest.fn<
      Promise<ApprovalInstanceEntity>,
      Parameters<WorkflowEngineService['submitApprovalInstance']>
    >(() => Promise.resolve(new ApprovalInstanceEntity()));
    const mutations = new WorkflowEngineMutations({
      submitApprovalInstance,
    } as unknown as WorkflowEngineService);
    // The input type has no such field, but a client can still send extra
    // keys through a loosely configured pipe; the mutation must not forward it.
    const input = {
      businessKey: 'PO-FORGED',
      formDataJson: '{}',
      initiatorMemberId: null,
      initiatorMetadataSnapshotJson: '{"memberId":"someone-else"}',
      templateId: 'template-1',
      title: null,
    } as SubmitApprovalInstanceInput;

    await mutations.submitApprovalInstance(input, 'member-001', {
      memberId: 'member-001',
    } as BPMAuthContext);

    expect(submitApprovalInstance).toHaveBeenCalledTimes(1);
    expect(submitApprovalInstance.mock.calls[0]?.[0]).toMatchObject({
      businessKey: null,
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
    });
  });

  const authContext = { memberId: 'member-current' } as BPMAuthContext;
  const createMutations = (): {
    readonly mutations: WorkflowEngineMutations;
    readonly submitApprovalInstance: jest.Mock;
  } => {
    const submitApprovalInstance = jest.fn(() => Promise.resolve({}));

    return {
      mutations: new WorkflowEngineMutations({
        submitApprovalInstance,
      } as unknown as WorkflowEngineService),
      submitApprovalInstance,
    };
  };

  it('submits as the signed-in member and records them as the submitter', async (): Promise<void> => {
    const { mutations, submitApprovalInstance } = createMutations();

    await mutations.submitApprovalInstance(
      {
        formDataJson: '{}',
        initiatorMemberId: null,
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: null,
      },
      'member-current',
      authContext,
    );

    expect(submitApprovalInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        initiatorMemberId: 'member-current',
        submittedByMemberId: 'member-current',
      }),
      authContext,
    );
  });

  it('ignores a submitter smuggled into the input', async (): Promise<void> => {
    const { mutations, submitApprovalInstance } = createMutations();

    await mutations.submitApprovalInstance(
      {
        formDataJson: '{}',
        initiatorMemberId: 'member-someone-else',
        initiatorMetadataSnapshotJson: null,
        submittedByMemberId: 'member-someone-else',
        templateId: 'template-1',
        title: null,
      } as SubmitApprovalInstanceInput,
      'member-current',
      authContext,
    );

    expect(submitApprovalInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        initiatorMemberId: 'member-current',
        submittedByMemberId: 'member-current',
      }),
      authContext,
    );
  });

  it('marks GraphQL submissions as end-user submissions', async (): Promise<void> => {
    const { mutations, submitApprovalInstance } = createMutations();

    await mutations.submitApprovalInstance(
      {
        // Not on the input type: a client must not be able to switch it off.
        endUserSubmission: false,
        formDataJson: '{}',
        initiatorMemberId: null,
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: null,
      } as SubmitApprovalInstanceInput,
      'member-current',
      authContext,
    );

    expect(submitApprovalInstance).toHaveBeenCalledWith(
      expect.objectContaining({ endUserSubmission: true }),
      authContext,
    );
  });

  it('marks GraphQL resubmissions as end-user submissions', async (): Promise<void> => {
    const resubmitApprovalInstance = jest.fn(() => Promise.resolve({}));
    const mutations = new WorkflowEngineMutations({
      resubmitApprovalInstance,
    } as unknown as WorkflowEngineService);

    await mutations.resubmitApprovalInstance(
      {
        endUserSubmission: false,
        formDataJson: '{}',
        initiatorMemberId: 'member-someone-else',
        instanceId: 'instance-1',
        title: null,
      } as ResubmitApprovalInstanceInput,
      'member-current',
      authContext,
    );

    expect(resubmitApprovalInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        endUserSubmission: true,
        initiatorMemberId: 'member-current',
      }),
      authContext,
    );
  });
});

describe('WorkflowEngineMutations decideTask', () => {
  const TASK_ID = '6f1c2a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
  const createMutations = (): {
    readonly decideTask: jest.Mock;
    readonly mutations: WorkflowEngineMutations;
  } => {
    const decideTask = jest.fn(() => Promise.resolve({}));

    return {
      decideTask,
      mutations: new WorkflowEngineMutations({
        decideTask,
      } as unknown as WorkflowEngineService),
    };
  };
  const input = (extra: Partial<DecideTaskInput>): DecideTaskInput =>
    ({
      action: TaskDecisionActionEnum.APPROVED,
      decidedByMemberId: 'member-forged',
      taskId: TASK_ID,
      ...extra,
    }) as DecideTaskInput;

  it('requires a fingerprint with formDataJson on the GraphQL path', async (): Promise<void> => {
    const { decideTask, mutations } = createMutations();

    await expect(
      mutations.decideTask(
        input({ formDataJson: '{"financeItems":[]}' }),
        'member-current',
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'expectedFormDataFingerprint is required when formDataJson is set',
      ),
    );
    await expect(
      mutations.decideTask(
        input({
          expectedFormDataFingerprint: null,
          formDataJson: '{"financeItems":[]}',
        }),
        'member-current',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(decideTask).not.toHaveBeenCalled();
  });

  it('requires a fingerprint even for an empty object', async (): Promise<void> => {
    const { decideTask, mutations } = createMutations();

    await expect(
      mutations.decideTask(input({ formDataJson: '{}' }), 'member-current'),
    ).rejects.toThrow(
      new BadRequestException(
        'expectedFormDataFingerprint is required when formDataJson is set',
      ),
    );
    expect(decideTask).not.toHaveBeenCalled();
  });

  it('passes formDataJson and the fingerprint on as the signed-in member', async (): Promise<void> => {
    const { decideTask, mutations } = createMutations();

    await mutations.decideTask(
      input({
        expectedFormDataFingerprint: 'fingerprint-1',
        formDataJson: '{"financeItems":[]}',
      }),
      'member-current',
    );

    expect(decideTask).toHaveBeenCalledWith(
      expect.objectContaining({
        decidedByMemberId: 'member-current',
        expectedFormDataFingerprint: 'fingerprint-1',
        formDataJson: '{"financeItems":[]}',
      }),
    );
  });

  it('does not ask for a fingerprint when no formDataJson is sent', async (): Promise<void> => {
    const { decideTask, mutations } = createMutations();

    await mutations.decideTask(input({}), 'member-current');

    expect(decideTask).toHaveBeenCalledTimes(1);
  });
});

describe('WorkflowEngineMutations task reassignment', () => {
  const TASK_ID = '6f1c2a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

  it('acts as the signed-in administrator, never as a member named in the input', async (): Promise<void> => {
    const reassignTask = jest.fn(() => Promise.resolve({}));
    const reassignMemberTasks = jest.fn(() => Promise.resolve([]));
    const mutations = new WorkflowEngineMutations({
      reassignMemberTasks,
      reassignTask,
    } as unknown as WorkflowEngineService);

    await mutations.reassignTask(
      {
        dryRun: true,
        fromMemberId: 'member-from',
        reason: '離職',
        taskId: TASK_ID,
        toMemberId: 'member-to',
      },
      'admin-001',
    );
    await mutations.reassignMemberTasks(
      {
        dryRun: null,
        fromMemberId: 'member-from',
        reason: '離職',
        toMemberId: 'member-to',
      },
      'admin-001',
    );

    expect(reassignTask).toHaveBeenCalledWith(TASK_ID, {
      actorMemberId: 'admin-001',
      dryRun: true,
      fromMemberId: 'member-from',
      reason: '離職',
      toMemberId: 'member-to',
    });
    expect(reassignMemberTasks).toHaveBeenCalledWith({
      actorMemberId: 'admin-001',
      dryRun: null,
      fromMemberId: 'member-from',
      reason: '離職',
      toMemberId: 'member-to',
    });
  });

  it('guards the reassignment and member task entry points with the admin level', (): void => {
    const access = (
      resolverName: string,
      methodName: string,
    ): string | undefined =>
      listBPMResolverHandlers().find(
        (handler) =>
          handler.resolverName === resolverName &&
          handler.methodName === methodName,
      )?.access;

    expect(access('WorkflowEngineMutations', 'reassignTask')).toBe('admin');
    expect(access('WorkflowEngineMutations', 'reassignMemberTasks')).toBe(
      'admin',
    );
    expect(access('WorkflowEngineQueries', 'memberOpenTasks')).toBe('admin');
  });
});
