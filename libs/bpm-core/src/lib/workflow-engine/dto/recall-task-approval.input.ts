import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class RecallTaskApprovalInput {
  /**
   * The task the signer approved. The task alone decides which decision is
   * taken back, so no decision id is asked for.
   */
  @Field()
  @IsUUID()
  taskId!: string;

  /**
   * Why the signer takes it back; kept on the record. Capped (in UTF-16 code
   * units, the JS string length) because it is stored whole in the activity
   * log payload and sent back with every timeline load.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}
