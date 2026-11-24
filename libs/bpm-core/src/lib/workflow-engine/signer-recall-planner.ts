import { NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import {
  SIGNER_RECALL_ERROR_CODES,
  type SignerRecallErrorCode,
} from '@rytass/bpm-core-shared/status';
import type { WorkflowNode } from '@rytass/bpm-core-shared/workflow';
import { ActivityLogEntity } from './activity-log.entity';
import { AdhocDirectiveEntity } from './adhoc-directive.entity';
import {
  AdhocDirectiveStatusEnum,
  AdhocDirectiveTypeEnum,
} from './adhoc.enums';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskCandidateEntity } from './task-candidate.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import { WorkflowTokenEntity } from './workflow-token.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceStateEnum,
  TaskCandidateStatusEnum,
  TaskDecisionActionEnum,
  TaskStatusEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';

/*
 * Decides whether a signer may still take back an approval they gave, and
 * gathers what the write side needs. Not exported from the package: it is an
 * internal of the workflow engine, like `stuck-approval-instance.query.ts`.
 *
 * Rules, in the order they are checked (the first one that fails names the
 * refusal):
 *
 *   R0   the host turned the feature on
 *   --   the stage was settled by exactly one approval (D); any other
 *        decision on the task is a transfer
 *   R1   D was given by the member asking
 *   R12  that task was not taken back before
 *   R2   D is a person's approval (found by `decisionId`, not `automatic`)
 *   R3   the instance is RUNNING
 *   R4a  the task is COMPLETED
 *   R4b  no other approval stands on the stage (token, node)
 *   R5   the stage has no ad-hoc task
 *   R11  the member's own seat on the task is a COMPLETED candidate row
 *   R13  that seat came from no delegation rule: its chain is empty or ends
 *        in a known manual transfer
 *   R14  the stage's notice was not already sent at approval time
 *   R6   nothing after D is anything but an allowed record
 *   R7   one open token only, waiting on the next user task
 *   R8   one open task only, on that token and node
 *   R9   the token passed no service task
 *   R10  the token passed no join
 *
 * Reads use equality, `In` and nothing else, and every `seq` comparison is
 * done here with BigInt: the engine's own test double ignores any other
 * operator without saying so. No query leans on a template node id alone,
 * since every instance of a template shares its node ids.
 */

/** Everything the write side needs once a recall is allowed. */
export interface SignerRecallPlan {
  /** The open task of the next stage, to be cancelled. */
  readonly cancelledTaskIds: readonly string[];
  /** D: the approval being taken back. */
  readonly decision: TaskDecisionEntity;
  readonly instance: ApprovalInstanceEntity;
  /** N: where the token stands now. */
  readonly nextNodeId: string;
  /** The signer's own COMPLETED seat on the task, to be copied. */
  readonly seat: TaskCandidateEntity;
  /** s0: the `seq` of D's TASK_DECIDED record. */
  readonly startSeq: bigint;
  /** X: the signer's task on their own stage (M). */
  readonly task: TaskEntity;
  /** T: the token that carried the approval on. */
  readonly token: WorkflowTokenEntity;
}

export type SignerRecallPlanResult =
  | { readonly refusalCode: SignerRecallErrorCode }
  | { readonly plan: SignerRecallPlan };

export interface SignerRecallPlanInput {
  /** Reason of an administrator reassignment's delegation step. */
  readonly adminReassignReason: string;
  /** Whether the host turned `signerRecallEnabled` on. */
  readonly enabled: boolean;
  /** Reason of an approver-initiated transfer's delegation step. */
  readonly manualTransferReason: string;
  readonly memberId: string;
  readonly taskId: string;
}

const refuse = (
  refusalCode: SignerRecallErrorCode,
): SignerRecallPlanResult => ({
  refusalCode,
});

const isPlainRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * R13. Reads the seat's raw chain, not a normalised one: a normaliser drops a
 * step that lacks a field, which would let a malformed tail fall back to the
 * step before it and pass. Anything unrecognised is refused.
 */
function endsInKnownManualTransfer(
  chain: unknown,
  signerMemberId: string,
  manualTransferReason: string,
  adminReassignReason: string,
): boolean {
  if (!Array.isArray(chain)) {
    return false;
  }

  if (chain.length === 0) {
    return true;
  }

  const tail: unknown = chain[chain.length - 1];

  if (!isPlainRecord(tail)) {
    return false;
  }

  const reason = tail['reason'];
  const ruleId = tail['ruleId'];

  if (typeof reason !== 'string') {
    return false;
  }

  if (reason !== manualTransferReason && reason !== adminReassignReason) {
    return false;
  }

  if (ruleId !== null && ruleId !== undefined) {
    return false;
  }

  return tail['to'] === signerMemberId;
}

/** The nodes the token walked through after D, apart from the stage itself. */
function readTokenPathNodeIds(
  laterLogs: readonly ActivityLogEntity[],
  tokenId: string,
  stageNodeId: string,
): ReadonlySet<string> {
  return new Set(
    laterLogs
      .filter(
        (log): boolean =>
          log.eventType === ActivityLogEventTypeEnum.TOKEN_ADVANCED &&
          log.payload['tokenId'] === tokenId,
      )
      .flatMap((log): readonly unknown[] => [
        log.nodeId,
        log.payload['fromNodeId'],
        log.payload['toNodeId'],
      ])
      .filter(
        (nodeId): nodeId is string =>
          typeof nodeId === 'string' && nodeId !== stageNodeId,
      ),
  );
}

/** R6 for the service-task records, which are told apart by `payload.action`. */
function isAllowedServiceTaskRecord(
  log: ActivityLogEntity,
  pathNodeIds: ReadonlySet<string>,
): boolean {
  const action = log.payload['action'];

  if (action === 'ADHOC_WEBHOOK' || action === 'ADHOC_NOTIFY') {
    return true;
  }

  if (action === 'NOTIFY_WEBHOOK') {
    return true;
  }

  if (action === 'WEBHOOK') {
    return log.nodeId !== null && !pathNodeIds.has(log.nodeId);
  }

  return false;
}

/** R6: whether a record written after D leaves "nobody acted" true. */
function isAllowedLaterRecord(
  log: ActivityLogEntity,
  signerMemberId: string,
  pathNodeIds: ReadonlySet<string>,
): boolean {
  switch (log.eventType) {
    case ActivityLogEventTypeEnum.TOKEN_ADVANCED:
    case ActivityLogEventTypeEnum.TOKEN_CREATED:
    case ActivityLogEventTypeEnum.TASK_CREATED:
      return true;
    case ActivityLogEventTypeEnum.SLA_TRIGGERED:
      return true;
    case ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED:
      return true;
    case ActivityLogEventTypeEnum.ADVANCE_FAILED:
      return true;
    case ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED:
    case ActivityLogEventTypeEnum.SERVICE_TASK_FAILED:
      return isAllowedServiceTaskRecord(log, pathNodeIds);
    case ActivityLogEventTypeEnum.WEBHOOK_DELIVERY_RETRIED:
      return log.payload['action'] === 'NOTIFY_WEBHOOK';
    case ActivityLogEventTypeEnum.ADHOC_DIRECTIVE_CANCELLED:
      return (
        log.actorMemberId === null ||
        (log.actorMemberId === signerMemberId &&
          log.payload['directiveType'] ===
            AdhocDirectiveTypeEnum.COMPLETION_NOTIFY)
      );
    default:
      return false;
  }
}

/**
 * Decides whether `input.memberId` may take back the approval on
 * `input.taskId`. Throws `NotFoundException` when the task is unknown (and the
 * feature is on). The caller holds the instance lock when it writes; the
 * query path calls this without one.
 */
export async function planSignerRecall(
  manager: EntityManager,
  input: SignerRecallPlanInput,
): Promise<SignerRecallPlanResult> {
  if (!input.enabled) {
    return refuse(SIGNER_RECALL_ERROR_CODES.DISABLED);
  }

  const task = await manager
    .getRepository(TaskEntity)
    .findOne({ where: { id: input.taskId } });

  if (!task) {
    throw new NotFoundException(`Task ${input.taskId} was not found`);
  }

  const instance = await manager
    .getRepository(ApprovalInstanceEntity)
    .findOne({ where: { id: task.instanceId } });

  if (!instance) {
    throw new NotFoundException(`Instance ${task.instanceId} was not found`);
  }

  // the stage was settled by exactly one approval
  const decisions = await manager
    .getRepository(TaskDecisionEntity)
    .find({ where: { taskId: task.id } });
  const [decision, ...otherApprovals] = decisions.filter(
    (candidate): boolean =>
      candidate.action === TaskDecisionActionEnum.APPROVED,
  );
  const everythingElseIsTransfer = decisions.every(
    (candidate): boolean =>
      candidate.action === TaskDecisionActionEnum.APPROVED ||
      candidate.action === TaskDecisionActionEnum.TRANSFERRED,
  );

  if (
    decision === undefined ||
    otherApprovals.length > 0 ||
    !everythingElseIsTransfer
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.STAGE_NOT_SETTLED_BY_THIS_APPROVAL);
  }

  // R1
  if (decision.decidedByMemberId !== input.memberId) {
    return refuse(SIGNER_RECALL_ERROR_CODES.NOT_THE_SIGNER);
  }

  const logs = await manager
    .getRepository(ActivityLogEntity)
    .find({ where: { instanceId: instance.id } });

  // R12
  if (
    logs.some(
      (log): boolean =>
        log.eventType === ActivityLogEventTypeEnum.TASK_RECALLED &&
        log.taskId === task.id,
    )
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.ALREADY_RECALLED);
  }

  // R2
  const decidedLog = logs.find(
    (log): boolean =>
      log.eventType === ActivityLogEventTypeEnum.TASK_DECIDED &&
      log.payload['decisionId'] === decision.id,
  );

  if (decidedLog === undefined) {
    return refuse(SIGNER_RECALL_ERROR_CODES.NOT_A_PERSONAL_APPROVAL);
  }

  if (decidedLog.payload['automatic']) {
    return refuse(SIGNER_RECALL_ERROR_CODES.NOT_A_PERSONAL_APPROVAL);
  }

  const startSeq = BigInt(decidedLog.seq);

  // R3
  if (instance.state !== ApprovalInstanceStateEnum.RUNNING) {
    return refuse(SIGNER_RECALL_ERROR_CODES.INSTANCE_NOT_RUNNING);
  }

  // R4a
  if (task.status !== TaskStatusEnum.COMPLETED) {
    return refuse(SIGNER_RECALL_ERROR_CODES.STAGE_NOT_SETTLED_BY_THIS_APPROVAL);
  }

  // R4b and R5 read the same stage: every task of this token on this node.
  const stageTasks = await manager.getRepository(TaskEntity).find({
    where: {
      instanceId: instance.id,
      nodeId: task.nodeId,
      tokenId: task.tokenId,
    },
  });
  const stageDecisions = await manager.getRepository(TaskDecisionEntity).find({
    where: {
      taskId: In(
        stageTasks
          .filter((stageTask): boolean => !stageTask.isAdhoc)
          .map(({ id }): string => id),
      ),
    },
  });

  // R4b
  if (
    stageDecisions.some(
      (stageDecision): boolean =>
        stageDecision.action === TaskDecisionActionEnum.APPROVED &&
        stageDecision.id !== decision.id,
    )
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.STAGE_NOT_SETTLED_BY_THIS_APPROVAL);
  }

  // R5
  if (
    task.isAdhoc ||
    stageTasks.some((stageTask): boolean => stageTask.isAdhoc)
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.STAGE_NOT_SETTLED_BY_THIS_APPROVAL);
  }

  // R11
  const candidates = await manager
    .getRepository(TaskCandidateEntity)
    .find({ where: { taskId: task.id } });
  const seat = candidates.find(
    (candidate): boolean =>
      candidate.memberId === decision.decidedByMemberId &&
      candidate.status === TaskCandidateStatusEnum.COMPLETED,
  );

  if (seat === undefined) {
    return refuse(SIGNER_RECALL_ERROR_CODES.STAGE_NOT_SETTLED_BY_THIS_APPROVAL);
  }

  // R13
  if (
    !endsInKnownManualTransfer(
      seat.delegationChain,
      decision.decidedByMemberId,
      input.manualTransferReason,
      input.adminReassignReason,
    )
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.DELEGATED_SEAT);
  }

  // R14: only equality here; the time is compared below.
  const stageNotices = await manager.getRepository(AdhocDirectiveEntity).find({
    where: {
      instanceId: instance.id,
      originNodeId: task.nodeId,
      status: AdhocDirectiveStatusEnum.CONSUMED,
      type: AdhocDirectiveTypeEnum.STAGE_NOTIFY,
    },
  });

  if (
    stageNotices.some(
      (notice): boolean =>
        notice.consumedAt !== null &&
        notice.consumedAt.getTime() >= decision.decidedAt.getTime(),
    )
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.STAGE_NOTIFY_SENT);
  }

  // R6
  const laterLogs = logs.filter((log): boolean => BigInt(log.seq) > startSeq);
  const pathNodeIds = readTokenPathNodeIds(
    laterLogs,
    task.tokenId,
    task.nodeId,
  );

  if (
    !laterLogs.every((log): boolean =>
      isAllowedLaterRecord(log, input.memberId, pathNodeIds),
    )
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.NEXT_STAGE_ACTED);
  }

  // R7
  const tokens = await manager
    .getRepository(WorkflowTokenEntity)
    .find({ where: { instanceId: instance.id } });
  const openTokens = tokens.filter(
    (candidate): boolean =>
      candidate.status === WorkflowTokenStatusEnum.ACTIVE ||
      candidate.status === WorkflowTokenStatusEnum.WAITING,
  );
  const token = tokens.find(
    (candidate): boolean => candidate.id === task.tokenId,
  );
  const nextNodeId = token?.currentNodeId ?? null;
  const nextNode = instance.workflowSnapshot.nodes.find(
    (node): boolean => node.id === nextNodeId,
  );

  if (
    token === undefined ||
    nextNodeId === null ||
    openTokens.length !== 1 ||
    openTokens[0]?.id !== token.id ||
    token.status !== WorkflowTokenStatusEnum.WAITING ||
    nextNodeId === task.nodeId ||
    nextNode?.type !== 'userTask'
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.NEXT_STAGE_NOT_SINGLE);
  }

  // R8
  const instanceTasks = await manager
    .getRepository(TaskEntity)
    .find({ where: { instanceId: instance.id } });
  const openTasks = instanceTasks.filter(
    (candidate): boolean =>
      candidate.status === TaskStatusEnum.PENDING ||
      candidate.status === TaskStatusEnum.IN_PROGRESS,
  );

  if (
    openTasks.length !== 1 ||
    openTasks[0]?.isAdhoc !== false ||
    openTasks[0].tokenId !== token.id ||
    openTasks[0].nodeId !== nextNodeId
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.NEXT_STAGE_NOT_SINGLE);
  }

  // R9: the nodes the token went through, the next stage included.
  const walkedNodeIds = new Set([...pathNodeIds, nextNodeId]);
  const walkedNodes = [...walkedNodeIds].map(
    (nodeId): WorkflowNode | undefined =>
      instance.workflowSnapshot.nodes.find(
        (node): boolean => node.id === nodeId,
      ),
  );

  if (
    walkedNodes.some(
      (node): boolean => node === undefined || node.type === 'serviceTask',
    )
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.PASSED_SERVICE_TASK);
  }

  // R10: a child token that walked into a join left no trace of its siblings.
  if (
    token.parentTokenId !== null &&
    [...walkedNodeIds].some(
      (nodeId): boolean =>
        instance.workflowSnapshot.edges.filter(
          (edge): boolean => edge.target === nodeId,
        ).length >= 2,
    )
  ) {
    return refuse(SIGNER_RECALL_ERROR_CODES.PASSED_JOIN);
  }

  return {
    plan: {
      cancelledTaskIds: openTasks.map(({ id }): string => id),
      decision,
      instance,
      nextNodeId,
      seat,
      startSeq,
      task,
      token,
    },
  };
}
