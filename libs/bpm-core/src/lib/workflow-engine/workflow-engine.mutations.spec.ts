import { BPMAuthContext } from '../bpm-auth';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { WorkflowEngineMutations } from './workflow-engine.mutations';
import { WorkflowEngineService } from './workflow-engine.service';

describe('WorkflowEngineMutations', () => {
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
});
