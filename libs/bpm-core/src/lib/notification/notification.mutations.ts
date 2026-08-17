import { Args, Int, Mutation, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated, BPMCurrentMemberId } from '../bpm-auth';
import { UpdateNotificationPreferenceInput } from './dto/notification-preference.input';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import { NotificationService } from './notification.service';

@Resolver()
@BPMAuthenticated()
export class NotificationMutations {
  constructor(private readonly notificationService: NotificationService) {}

  @Mutation(() => NotificationEntity)
  async markNotificationRead(
    @Args('id', { type: () => String }) id: string,
    @Args('readerMemberId', { nullable: true, type: () => String })
    readerMemberId?: string | null,
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<NotificationEntity> {
    return this.notificationService.markNotificationRead({
      id,
      readerMemberId: currentMemberId ?? readerMemberId ?? null,
    });
  }

  @Mutation(() => Int)
  async markAllNotificationsRead(
    @BPMCurrentMemberId() currentMemberId: string,
    @Args('recipientMemberId', { nullable: true, type: () => String })
    recipientMemberId?: string | null,
  ): Promise<number> {
    return this.notificationService.markAllNotificationsRead({
      recipientMemberId: currentMemberId ?? recipientMemberId ?? '',
    });
  }

  @Mutation(() => Int)
  async archiveNotifications(
    @Args('ids', { type: () => [String] }) ids: readonly string[],
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<number> {
    return this.notificationService.archiveNotifications({
      ids,
      memberId: currentMemberId,
    });
  }

  @Mutation(() => Int)
  async unarchiveNotifications(
    @Args('ids', { type: () => [String] }) ids: readonly string[],
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<number> {
    return this.notificationService.unarchiveNotifications({
      ids,
      memberId: currentMemberId,
    });
  }

  @Mutation(() => NotificationPreferenceEntity)
  async updateNotificationPreference(
    @Args('input') input: UpdateNotificationPreferenceInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<NotificationPreferenceEntity> {
    return this.notificationService.updatePreference({
      ...input,
      memberId: currentMemberId,
    });
  }
}
