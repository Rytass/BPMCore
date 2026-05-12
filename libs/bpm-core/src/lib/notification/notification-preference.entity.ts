import { Field, ObjectType } from '@nestjs/graphql';
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { NotificationDigestModeEnum } from './notification.enums';

@Entity('notification_preferences')
@ObjectType('NotificationPreference')
export class NotificationPreferenceEntity {
  @PrimaryColumn('text', { name: 'member_id' })
  @Field()
  memberId!: string;

  @Column('boolean', { name: 'in_app_enabled', default: true })
  @Field()
  inAppEnabled!: boolean;

  @Column('boolean', { name: 'email_enabled', default: true })
  @Field()
  emailEnabled!: boolean;

  @Column('text', { name: 'email_digest_mode' })
  @Field(() => NotificationDigestModeEnum)
  emailDigestMode!: NotificationDigestModeEnum;

  @Column('time', { name: 'quiet_hours_start', nullable: true })
  @Field(() => String, { nullable: true })
  quietHoursStart!: string | null;

  @Column('time', { name: 'quiet_hours_end', nullable: true })
  @Field(() => String, { nullable: true })
  quietHoursEnd!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;
}
