import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { NotificationDigestModeEnum } from '../notification.enums';

const TIME_ONLY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

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
  @Matches(TIME_ONLY_PATTERN, {
    message: 'quietHoursStart must use HH:mm or HH:mm:ss format',
  })
  quietHoursStart!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(TIME_ONLY_PATTERN, {
    message: 'quietHoursEnd must use HH:mm or HH:mm:ss format',
  })
  quietHoursEnd!: string | null;
}
