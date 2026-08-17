import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated, BPMCurrentMemberId } from '../bpm-auth';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import { NotificationService } from './notification.service';

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
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<readonly NotificationEntity[]> {
    return this.notificationService.listNotifications({
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

  @Query(() => NotificationPreferenceEntity)
  async notificationPreference(
    @Args('memberId', { type: () => String }) memberId: string,
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<NotificationPreferenceEntity> {
    return this.notificationService.getPreference(currentMemberId ?? memberId);
  }
}
