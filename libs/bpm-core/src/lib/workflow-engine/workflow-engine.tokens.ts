import { CancelApprovalInstanceInput } from './dto/cancel-approval-instance.input';
import { DecideTaskInput } from './dto/decide-task.input';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskDecisionEntity } from './task-decision.entity';

export const BPM_WORKFLOW_ENGINE_SERVICE = Symbol(
  'BPM_WORKFLOW_ENGINE_SERVICE',
);

export interface BPMWorkflowEngineService {
  cancelApprovalInstance(
    input: CancelApprovalInstanceInput,
  ): Promise<ApprovalInstanceEntity>;
  decideTask(input: DecideTaskInput): Promise<TaskDecisionEntity>;
}
