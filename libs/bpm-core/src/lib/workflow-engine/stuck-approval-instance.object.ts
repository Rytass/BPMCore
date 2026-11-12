import { Field, ID, ObjectType } from '@nestjs/graphql';
import { StuckApprovalInstanceKindEnum } from './workflow-engine.enums';

/**
 * An approval instance that could not move on to its next stage, as the
 * administrator's stuck-instances screen lists it: one row per instance, from
 * its latest unresolved failure.
 */
@ObjectType('StuckApprovalInstance')
export class StuckApprovalInstanceObject {
  @Field(() => ID, { description: 'The stuck instance.' })
  instanceId!: string;

  @Field({ description: 'Title of the stuck instance.' })
  instanceTitle!: string;

  @Field(() => ID, { description: 'The template the instance was filed from.' })
  templateId!: string;

  @Field(() => String, {
    description: 'Name of that template; null when it can no longer be read.',
    nullable: true,
  })
  templateName!: string | null;

  @Field({ description: 'Who filed the instance.' })
  initiatorMemberId!: string;

  @Field(() => StuckApprovalInstanceKindEnum, {
    description:
      'DECISION: a decision on a task could not move the instance on. ' +
      'RESUBMIT: the initiator resubmitted a returned instance and it could not start.',
  })
  kind!: StuckApprovalInstanceKindEnum;

  @Field(() => String, {
    description:
      'The node the failed decision was made on; null for RESUBMIT.',
    nullable: true,
  })
  nodeId!: string | null;

  @Field(() => String, {
    description:
      'Display name of that node, read from the instance workflow snapshot; ' +
      'null for RESUBMIT or when the node carries no label.',
    nullable: true,
  })
  nodeLabel!: string | null;

  @Field(() => ID, {
    description: 'The task the failed decision was made on; null for RESUBMIT.',
    nullable: true,
  })
  taskId!: string | null;

  @Field(() => [String], {
    description:
      'Who has to press again now, read when the list is loaded. DECISION: ' +
      'the members whose seat on the task is PENDING or CLAIMED (WAITING ' +
      'seats are not their turn yet), or the assignee of a task that has no ' +
      'candidate rows at all; it follows a later reassignment. RESUBMIT: the ' +
      'initiator only.',
  })
  pendingActorMemberIds!: string[];

  @Field(() => String, {
    description:
      'The member the failed attempt was made as. For an automatic approval ' +
      'this is the holder the system picked, who did not press anything: ' +
      'read `automatic` first.',
    nullable: true,
  })
  failedActorMemberId!: string | null;

  @Field(() => String, {
    description:
      "'SLA_AUTO_APPROVE' when the failed attempt was the system approving " +
      'an overdue task, null when a person pressed the button.',
    nullable: true,
  })
  automatic!: string | null;

  @Field({
    description: 'Why the instance could not move on, as the operator saw it.',
  })
  message!: string;

  @Field({ description: 'When the failed attempt was recorded.' })
  failedAt!: Date;
}
