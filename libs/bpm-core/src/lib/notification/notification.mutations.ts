import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UpdateNotificationPreferenceInput } from './dto/notification-preference.input';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import { NotificationService } from './notification.service';

@Resolver()
export class NotificationMutations {
  constructor(private readonly notificationService: NotificationService) {}

  @Mutation(() => NotificationEntity)
  async markNotificationRead(
    @Args('id', { type: () => String }) id: string,
    @Args('readerMemberId', { nullable: true, type: () => String })
    readerMemberId?: string | null,
  ): Promise<NotificationEntity> {
    return this.notificationService.markNotificationRead({
      id,
      readerMemberId: readerMemberId ?? null,
    });
  }

  @Mutation(() => NotificationPreferenceEntity)
  async updateNotificationPreference(
    @Args('input') input: UpdateNotificationPreferenceInput,
  ): Promise<NotificationPreferenceEntity> {
    return this.notificationService.updatePreference(input);
  }
}
