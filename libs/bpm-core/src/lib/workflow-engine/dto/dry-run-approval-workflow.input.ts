import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString } from 'class-validator';

@InputType()
export class DryRunApprovalWorkflowInput {
  @Field()
  @IsString()
  workflowDefinitionJson!: string;

  @Field()
  @IsString()
  formDataJson!: string;

  @Field()
  @IsString()
  initiatorMemberId!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  initiatorMetadataSnapshotJson!: string | null;

  /**
   * The form schema of the template being tried. Used only when the host turns
   * on `expressionMissingFormFieldsAsNull`, so the dry run fills unfilled
   * fields the way a real case would (ADR 27 §3); without it the form data is
   * read as given.
   */
  @Field(() => String, {
    description:
      'Form schema JSON of the template being tried. Only read when the host enables expressionMissingFormFieldsAsNull: unfilled top-level fields are then read as null ([] for a table), as in a real case.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  formSchemaJson?: string | null;
}
