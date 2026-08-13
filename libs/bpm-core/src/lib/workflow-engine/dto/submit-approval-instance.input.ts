import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class SubmitApprovalInstanceInput {
  @Field()
  @IsUUID()
  templateId!: string;

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

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  initiatorMetadataSnapshotJson!: string | null;

  @Field()
  @IsString()
  formDataJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  title!: string | null;
}
