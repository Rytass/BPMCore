import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * A cheap "has anything changed" probe for a member's in-app notifications.
 * A host polling for changes reads this and re-reads the list only when
 * `latestUpdatedAt` or `unreadCount` moved.
 */
@ObjectType('NotificationSummary')
export class NotificationSummaryObject {
  @Field(() => Int, {
    description: '未讀且未封存的站內通知數（與小鈴鐺徽章一致）',
  })
  unreadCount!: number;

  @Field(() => Date, {
    description:
      '該成員所有站內通知（含已讀、已封存）中最近一次變動的時間；沒有任何通知時為 null',
    nullable: true,
  })
  latestUpdatedAt!: Date | null;
}
