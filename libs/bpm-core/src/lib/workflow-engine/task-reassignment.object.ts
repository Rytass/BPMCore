import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  MemberTaskRoleEnum,
  TaskCandidateStatusEnum,
  TaskReassignmentErrorCodeEnum,
  TaskReassignmentOutcomeEnum,
} from './workflow-engine.enums';

/** One row of an administrator reassignment: what happened to one task. */
@ObjectType('TaskReassignmentResult')
export class TaskReassignmentResultObject {
  @Field(() => ID)
  taskId!: string;

  @Field(() => ID)
  instanceId!: string;

  @Field()
  nodeId!: string;

  @Field(() => TaskReassignmentOutcomeEnum)
  outcome!: TaskReassignmentOutcomeEnum;

  @Field(() => TaskReassignmentErrorCodeEnum, { nullable: true })
  errorCode!: TaskReassignmentErrorCodeEnum | null;

  @Field(() => String, { nullable: true })
  message!: string | null;
}

/** An open task that a member holds, as the administrator's reassignment screen lists it. */
@ObjectType('MemberOpenTask')
export class MemberOpenTaskObject {
  @Field(() => ID)
  taskId!: string;

  @Field(() => ID)
  instanceId!: string;

  @Field()
  instanceTitle!: string;

  @Field(() => String, { nullable: true })
  businessKey!: string | null;

  @Field(() => ID)
  templateId!: string;

  @Field(() => String, { nullable: true })
  templateName!: string | null;

  @Field()
  nodeId!: string;

  @Field(() => String, { nullable: true })
  nodeLabel!: string | null;

  @Field()
  decisionPolicyType!: string;

  @Field(() => MemberTaskRoleEnum)
  memberRole!: MemberTaskRoleEnum;

  @Field(() => TaskCandidateStatusEnum, { nullable: true })
  candidateStatus!: TaskCandidateStatusEnum | null;

  @Field(() => Date, { nullable: true })
  slaDueAt!: Date | null;

  @Field()
  createdAt!: Date;
}

/**
 * A member the host reports as deactivated who still holds open tasks, as the
 * administrator's member screen lists them for reassignment.
 */
@ObjectType('InactiveMemberWithOpenTasks')
export class InactiveMemberWithOpenTasksObject {
  @Field(() => ID)
  memberId!: string;

  @Field()
  name!: string;

  @Field()
  email!: string;

  /** Same count as `memberOpenTasks` returns rows for this member. */
  @Field(() => Int)
  openTaskCount!: number;
}
