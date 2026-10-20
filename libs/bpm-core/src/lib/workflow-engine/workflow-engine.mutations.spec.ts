import { BPMAuthContext, listBPMResolverHandlers } from '../bpm-auth';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { ResubmitApprovalInstanceInput } from './dto/resubmit-approval-instance.input';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
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
