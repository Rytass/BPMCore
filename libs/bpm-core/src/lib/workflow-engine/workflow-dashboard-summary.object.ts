import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('WorkflowDashboardSummary')
export class WorkflowDashboardSummaryObject {
  @Field(() => Int)
  activeInstanceCount!: number;

  @Field(() => Int)
  completedInstanceCount!: number;

  @Field(() => Int)
  overdueTaskCount!: number;

  @Field(() => Int)
  pendingTaskCount!: number;

  @Field(() => Int)
  rejectedInstanceCount!: number;

  @Field(() => Int)
  totalInstanceCount!: number;
}
