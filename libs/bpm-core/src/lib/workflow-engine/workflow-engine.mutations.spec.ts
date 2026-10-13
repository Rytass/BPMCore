import { BPMAuthContext } from '../bpm-auth';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { SubmitApprovalInstanceInput } from './dto/submit-approval-instance.input';
import { WorkflowEngineMutations } from './workflow-engine.mutations';
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
});
