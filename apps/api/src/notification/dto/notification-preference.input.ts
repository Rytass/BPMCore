import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { NotificationDigestModeEnum } from '../notification.enums';

@InputType()
export class UpdateNotificationPreferenceInput {
  @Field()
  @IsString()
  memberId!: string;

  @Field()
  @IsBoolean()
  inAppEnabled!: boolean;

  @Field()
  @IsBoolean()
  emailEnabled!: boolean;

  @Field(() => NotificationDigestModeEnum)
  @IsIn(Object.values(NotificationDigestModeEnum))
  emailDigestMode!: NotificationDigestModeEnum;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  quietHoursStart!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  quietHoursEnd!: string | null;
}
