import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

@InputType()
export class AdminCancelApprovalInstanceInput {
  @Field(() => ID)
  @IsUUID()
  instanceId!: string;

  /**
   * Why the administrator ends the instance. It is stored in the activity log
   * and sent to the initiator, so it is required (the service also refuses a
   * reason that is only whitespace).
   */
  @Field()
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
