import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { NotificationChannelEnum } from '../../notification/notification.enums';
import { AdhocTargetInput } from './adhoc-target.input';

@InputType()
export class AdhocNotificationInput {
  @Field(() => AdhocTargetInput)
  @Type(() => AdhocTargetInput)
  @ValidateNested()
  target!: AdhocTargetInput;

  @Field(() => [NotificationChannelEnum], { nullable: true })
  @IsOptional()
  @IsEnum(NotificationChannelEnum, { each: true })
  channels?: readonly NotificationChannelEnum[] | null;
}
