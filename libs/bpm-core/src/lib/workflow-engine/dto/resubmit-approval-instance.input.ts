import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class ResubmitApprovalInstanceInput {
  @Field()
  @IsUUID()
  instanceId!: string;

  /**
   * Ignored: the resolver always replaces it with the authenticated member id.
   * Kept as an optional field so existing callers keep working.
   */
  @Field(() => String, {
    deprecationReason:
      'The server derives the initiator from the authenticated member; this value is ignored.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  initiatorMemberId!: string | null;

  @Field()
  @IsString()
  formDataJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  title!: string | null;

  /**
   * The applicant's note on what changed; shown on the resubmission step.
   * Capped (in UTF-16 code units, the JS string length, before the service
   * trims it) because it is stored whole in the activity log payload and sent
   * back with every timeline load.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}
