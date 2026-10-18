import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated, BPMCurrentMemberId } from '../bpm-auth';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import { NotificationService } from './notification.service';
import { NotificationSummaryObject } from './notification-summary.object';

@Resolver()
@BPMAuthenticated()
export class NotificationQueries {
  constructor(private readonly notificationService: NotificationService) {}

  @Query(() => [NotificationEntity])
  async notifications(
    @Args('recipientMemberId', { type: () => String })
    recipientMemberId: string,
    @Args('includeRead', { nullable: true, type: () => Boolean })
    includeRead?: boolean | null,
    @Args('includeArchived', { nullable: true, type: () => Boolean })
    includeArchived?: boolean | null,
    @Args('page', { nullable: true, type: () => Int })
    page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
    @Args('beforeId', {
      description:
        'Keyset paging: rows that sort after this notification id (the last id of the previous page). Cannot be combined with page > 1.',
      nullable: true,
      type: () => String,
    })
    beforeId?: string | null,
    @Args('changedSince', {
      description:
        'Only rows whose updatedAt is later than this time; includeRead and includeArchived are then ignored so reads and archives are reported.',
      nullable: true,
      type: () => Date,
    })
    changedSince?: Date | null,
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<readonly NotificationEntity[]> {
    return this.notificationService.listNotifications({
      beforeId: beforeId ?? null,
      changedSince: changedSince ?? null,
      includeArchived: includeArchived ?? false,
      includeRead: includeRead ?? false,
      page: page ?? 1,
      pageSize: pageSize ?? 10,
      recipientMemberId: currentMemberId ?? recipientMemberId,
    });
  }

  @Query(() => Int)
  async notificationCount(
    @Args('recipientMemberId', { type: () => String })
    recipientMemberId: string,
    @Args('includeRead', { nullable: true, type: () => Boolean })
    includeRead?: boolean | null,
    @Args('includeArchived', { nullable: true, type: () => Boolean })
    includeArchived?: boolean | null,
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<number> {
    return this.notificationService.countNotifications({
      includeArchived: includeArchived ?? false,
      includeRead: includeRead ?? false,
      recipientMemberId: currentMemberId ?? recipientMemberId,
    });
  }

  @Query(() => Int)
  async unreadNotificationCount(
    @Args('recipientMemberId', { type: () => String })
    recipientMemberId: string,
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<number> {
    return this.notificationService.countUnreadNotifications(
      currentMemberId ?? recipientMemberId,
    );
  }

  @Query(() => NotificationSummaryObject)
  async notificationSummary(
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<NotificationSummaryObject> {
    return this.notificationService.readNotificationSummary(currentMemberId);
  }

  @Query(() => NotificationPreferenceEntity)
  async notificationPreference(
    @Args('memberId', { type: () => String }) memberId: string,
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<NotificationPreferenceEntity> {
    return this.notificationService.getPreference(currentMemberId ?? memberId);
  }
}
