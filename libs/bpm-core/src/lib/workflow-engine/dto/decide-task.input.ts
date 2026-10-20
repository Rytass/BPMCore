import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TaskDecisionActionEnum } from '../workflow-engine.enums';

@InputType()
export class DecideTaskInput {
  @Field()
  @IsUUID()
  taskId!: string;

  @Field()
  @IsString()
  decidedByMemberId!: string;

  @Field(() => TaskDecisionActionEnum)
  @IsEnum(TaskDecisionActionEnum)
  action!: TaskDecisionActionEnum;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  comment?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  returnToNodeId?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  transferToMemberId?: string | null;

  // No `@MaxLength`: submit, resubmit and decide all take a form-data JSON
  // string without a cap, so a cap belongs on all three or none.
  @Field(() => String, {
    description:
      'JSON object of approver-filled fields (top-level fieldKey to value), ' +
      'merged into the form data. Only with an APPROVED decision, only from a ' +
      'non-ad-hoc task on a node that lets approvers fill these fields in; ' +
      'requires expectedFormDataFingerprint.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  formDataJson?: string | null;

  @Field(() => String, {
    description:
      'The `formDataFingerprint` read with the instance. A mismatch means the form data changed since, and the decision is refused.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  expectedFormDataFingerprint?: string | null;
}
