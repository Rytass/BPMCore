import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('WorkflowDryRunStep')
export class WorkflowDryRunStepObject {
  @Field()
  id!: string;

  @Field()
  nodeId!: string;

  @Field()
  nodeLabel!: string;

  @Field()
  nodeType!: string;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  edgeId!: string | null;

  @Field(() => String, { nullable: true })
  edgeLabel!: string | null;

  @Field(() => Boolean, { nullable: true })
  edgeMatched!: boolean | null;

  @Field(() => String, { nullable: true })
  edgeReason!: string | null;

  @Field(() => Boolean, { nullable: true })
  edgeDefault!: boolean | null;

  @Field(() => String, { nullable: true })
  entryCondition!: string | null;

  @Field(() => Boolean, { nullable: true })
  entryConditionMatched!: boolean | null;

  @Field(() => String, { nullable: true })
  assigneeMemberId!: string | null;

  @Field()
  message!: string;
}

@ObjectType('WorkflowDryRunResult')
export class WorkflowDryRunResultObject {
  @Field()
  valid!: boolean;

  @Field(() => [String])
  errors!: readonly string[];

  @Field(() => [WorkflowDryRunStepObject])
  steps!: readonly WorkflowDryRunStepObject[];
}
