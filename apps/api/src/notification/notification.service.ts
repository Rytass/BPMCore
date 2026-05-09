import { UserTaskNode } from '@bpm/shared/workflow';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  LessThanOrEqual,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { parseIsoDurationToMilliseconds } from '../common/iso-duration';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import {
  ActivityLogEventTypeEnum,
  TaskStatusEnum,
} from '../workflow-engine/workflow-engine.enums';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import {
  NotificationChannelEnum,
  NotificationDigestModeEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
} from './notification.enums';
import { renderNotificationTemplate } from './notification-template';
import { UpdateNotificationPreferenceInput } from './dto/notification-preference.input';

const DEFAULT_TASK_CHANNELS: readonly NotificationChannelEnum[] = [
  NotificationChannelEnum.IN_APP,
];

interface CreateNotificationInput {
  readonly channels: readonly NotificationChannelEnum[];
  readonly instanceId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recipientMemberId: string;
  readonly taskId: string | null;
  readonly type: NotificationTypeEnum;
}

interface SlaScanResult {
  readonly overdueCount: number;
  readonly warningCount: number;
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(NotificationPreferenceEntity)
    private readonly notificationPreferenceRepository: Repository<NotificationPreferenceEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
    @InjectRepository(ApprovalInstanceEntity)
    private readonly approvalInstanceRepository: Repository<ApprovalInstanceEntity>,
    @InjectRepository(ActivityLogEntity)
    private readonly activityLogRepository: Repository<ActivityLogEntity>,
  ) {}

  async listNotifications({
    includeRead = false,
    recipientMemberId,
  }: {
    readonly includeRead?: boolean;
    readonly recipientMemberId: string;
  }): Promise<readonly NotificationEntity[]> {
    return this.notificationRepository.find({
      order: { createdAt: 'DESC' },
      where: {
        channel: NotificationChannelEnum.IN_APP,
        recipientMemberId,
        ...(includeRead ? {} : { status: Not(NotificationStatusEnum.READ) }),
      },
    });
  }

  async countUnreadNotifications(recipientMemberId: string): Promise<number> {
    return this.notificationRepository.count({
      where: {
        channel: NotificationChannelEnum.IN_APP,
        recipientMemberId,
        status: Not(NotificationStatusEnum.READ),
      },
    });
  }

  async markNotificationRead({
    id,
    readerMemberId,
  }: {
    readonly id: string;
    readonly readerMemberId: string | null;
  }): Promise<NotificationEntity> {
    const notification = await this.notificationRepository.findOne({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException(`Notification ${id} was not found`);
    }

    if (
      readerMemberId &&
      notification.recipientMemberId !== readerMemberId.trim()
    ) {
      throw new NotFoundException(`Notification ${id} was not found`);
    }

    return this.notificationRepository.save({
      ...notification,
      readAt: notification.readAt ?? new Date(),
      status: NotificationStatusEnum.READ,
    });
  }

  async getPreference(memberId: string): Promise<NotificationPreferenceEntity> {
    const existingPreference =
      await this.notificationPreferenceRepository.findOne({
        where: { memberId },
      });

    return existingPreference ?? createDefaultPreference(memberId);
  }

  async updatePreference(
    input: UpdateNotificationPreferenceInput,
  ): Promise<NotificationPreferenceEntity> {
    const currentPreference = await this.getPreference(input.memberId);

    return this.notificationPreferenceRepository.save({
      ...currentPreference,
      emailDigestMode: input.emailDigestMode,
      emailEnabled: input.emailEnabled,
      inAppEnabled: input.inAppEnabled,
      memberId: input.memberId,
      quietHoursEnd: normalizeTimeInput(input.quietHoursEnd),
      quietHoursStart: normalizeTimeInput(input.quietHoursStart),
    });
  }

  async createTaskAssignedNotification({
    instance,
    manager,
    node,
    task,
    transferred = false,
  }: {
    readonly instance: ApprovalInstanceEntity;
    readonly manager: EntityManager;
    readonly node: UserTaskNode;
    readonly task: TaskEntity;
    readonly transferred?: boolean;
  }): Promise<readonly NotificationEntity[]> {
    return this.createNotifications(
      {
        channels: readNodeNotificationChannels(node),
        instanceId: instance.id,
        payload: {
          assigneeMemberId: task.assigneeMemberId,
          instanceId: instance.id,
          instanceTitle: instance.title,
          nodeId: node.id,
          nodeLabel: node.data.label,
          originalAssigneeMemberId: task.originalAssigneeMemberId,
          slaDueAt: task.slaDueAt?.toISOString() ?? null,
          taskId: task.id,
        },
        recipientMemberId: task.assigneeMemberId,
        taskId: task.id,
        type: transferred
          ? NotificationTypeEnum.TASK_TRANSFERRED
          : NotificationTypeEnum.TASK_ASSIGNED,
      },
      manager,
    );
  }

  async runSlaScan(now: Date = new Date()): Promise<SlaScanResult> {
    const candidateTasks = await this.taskRepository.find({
      order: { slaDueAt: 'ASC' },
      where: [
        {
          slaDueAt: LessThanOrEqual(now),
          status: TaskStatusEnum.PENDING,
        },
        {
          slaDueAt: LessThanOrEqual(now),
          status: TaskStatusEnum.IN_PROGRESS,
        },
        {
          slaDueAt: MoreThan(now),
          status: TaskStatusEnum.PENDING,
        },
        {
          slaDueAt: MoreThan(now),
          status: TaskStatusEnum.IN_PROGRESS,
        },
      ],
    });
    const results = await candidateTasks.reduce<Promise<SlaScanResult>>(
      async (resultPromise, task): Promise<SlaScanResult> => {
        const currentResult = await resultPromise;
        const instance = await this.approvalInstanceRepository.findOne({
          where: { id: task.instanceId },
        });

        if (!instance) {
          return currentResult;
        }

        const node = readUserTaskNode(instance, task.nodeId);

        if (!node?.data.sla || !task.slaDueAt) {
          return currentResult;
        }

        if (task.slaDueAt.getTime() <= now.getTime()) {
          const created = await this.createSlaNotificationOnce({
            instance,
            node,
            task,
            type: NotificationTypeEnum.SLA_OVERDUE,
          });

          if (created) {
            await this.recordSlaActivity({
              instance,
              node,
              task,
              trigger: 'OVERDUE',
            });
            this.runSlaTimeoutHook({ instance, node, task });
          }

          return {
            overdueCount: currentResult.overdueCount + (created ? 1 : 0),
            warningCount: currentResult.warningCount,
          };
        }

        const warningAt = node.data.sla.warningAt;

        if (!warningAt || warningAt <= 0 || warningAt >= 1) {
          return currentResult;
        }

        const warningAtTime =
          task.createdAt.getTime() +
          (task.slaDueAt.getTime() - task.createdAt.getTime()) * warningAt;

        if (warningAtTime > now.getTime()) {
          return currentResult;
        }

        const created = await this.createSlaNotificationOnce({
          instance,
          node,
          task,
          type: NotificationTypeEnum.SLA_WARNING,
        });

        if (created) {
          await this.recordSlaActivity({
            instance,
            node,
            task,
            trigger: 'WARNING',
          });
        }

        return {
          overdueCount: currentResult.overdueCount,
          warningCount: currentResult.warningCount + (created ? 1 : 0),
        };
      },
      Promise.resolve({ overdueCount: 0, warningCount: 0 }),
    );

    return results;
  }

  private async createSlaNotificationOnce({
    instance,
    node,
    task,
    type,
  }: {
    readonly instance: ApprovalInstanceEntity;
    readonly node: UserTaskNode;
    readonly task: TaskEntity;
    readonly type: NotificationTypeEnum.SLA_OVERDUE | NotificationTypeEnum.SLA_WARNING;
  }): Promise<boolean> {
    const existingNotification = await this.notificationRepository.findOne({
      where: {
        channel: NotificationChannelEnum.IN_APP,
        taskId: task.id,
        type,
      },
    });

    if (existingNotification) {
      return false;
    }

    await this.createNotifications({
      channels: [NotificationChannelEnum.IN_APP],
      instanceId: instance.id,
      payload: {
        assigneeMemberId: task.assigneeMemberId,
        instanceId: instance.id,
        instanceTitle: instance.title,
        nodeId: node.id,
        nodeLabel: node.data.label,
        onTimeout: node.data.sla?.onTimeout ?? 'REMIND',
        slaDueAt: task.slaDueAt?.toISOString() ?? null,
        taskId: task.id,
      },
      recipientMemberId: task.assigneeMemberId,
      taskId: task.id,
      type,
    });

    return true;
  }

  private async createNotifications(
    input: CreateNotificationInput,
    manager?: EntityManager,
  ): Promise<readonly NotificationEntity[]> {
    const preference = await this.getPreference(input.recipientMemberId);
    const repository = manager
      ? manager.getRepository(NotificationEntity)
      : this.notificationRepository;
    const notifications = input.channels.flatMap((channel) =>
      isChannelEnabled(channel, preference)
        ? [
            createNotificationEntity({
              channel,
              input,
              repository,
            }),
          ]
        : [],
    );

    if (notifications.length === 0) {
      return [];
    }

    const savedNotifications = await repository.save(notifications);

    await Promise.all(
      savedNotifications
        .filter((notification) => notification.channel !== NotificationChannelEnum.IN_APP)
        .map((notification) => this.dispatchExternalNotification(notification)),
    );

    return savedNotifications;
  }

  private async recordSlaActivity({
    instance,
    node,
    task,
    trigger,
  }: {
    readonly instance: ApprovalInstanceEntity;
    readonly node: UserTaskNode;
    readonly task: TaskEntity;
    readonly trigger: 'OVERDUE' | 'WARNING';
  }): Promise<void> {
    await this.activityLogRepository.save(
      this.activityLogRepository.create({
        actorMemberId: null,
        eventType: ActivityLogEventTypeEnum.SLA_TRIGGERED,
        instanceId: instance.id,
        nodeId: task.nodeId,
        payload: {
          assigneeMemberId: task.assigneeMemberId,
          nodeLabel: node.data.label,
          onTimeout: node.data.sla?.onTimeout ?? 'REMIND',
          slaDueAt: task.slaDueAt?.toISOString() ?? null,
          trigger,
        },
        taskId: task.id,
      }),
    );
  }

  private async dispatchExternalNotification(
    notification: NotificationEntity,
  ): Promise<void> {
    console.log('[NotificationHook]', {
      channel: notification.channel,
      notificationId: notification.id,
      recipientMemberId: notification.recipientMemberId,
      title: notification.title,
      type: notification.type,
    });
  }

  private runSlaTimeoutHook({
    instance,
    node,
    task,
  }: {
    readonly instance: ApprovalInstanceEntity;
    readonly node: UserTaskNode;
    readonly task: TaskEntity;
  }): void {
    console.log('[SlaTimeoutHook]', {
      instanceId: instance.id,
      nodeId: node.id,
      onTimeout: node.data.sla?.onTimeout ?? 'REMIND',
      taskId: task.id,
    });
  }
}

export function calculateTaskSlaDueAt({
  node,
  now,
}: {
  readonly node: UserTaskNode;
  readonly now: Date;
}): Date | null {
  const duration = node.data.sla?.duration;

  if (!duration) {
    return null;
  }

  const durationMs = parseIsoDurationToMilliseconds(duration);

  return durationMs ? new Date(now.getTime() + durationMs) : null;
}

function createDefaultPreference(
  memberId: string,
): NotificationPreferenceEntity {
  return Object.assign(new NotificationPreferenceEntity(), {
    emailDigestMode: NotificationDigestModeEnum.INSTANT,
    emailEnabled: true,
    inAppEnabled: true,
    memberId,
    quietHoursEnd: null,
    quietHoursStart: null,
    updatedAt: new Date(0),
  });
}

function normalizeTimeInput(value: string | null): string | null {
  const trimmedValue = value?.trim() ?? '';

  return trimmedValue || null;
}

function readNodeNotificationChannels(
  node: UserTaskNode,
): readonly NotificationChannelEnum[] {
  const configuredChannels = node.data.notification?.channels ?? [];
  const channels = configuredChannels
    .map((channel): NotificationChannelEnum | null =>
      channel === 'EMAIL'
        ? NotificationChannelEnum.EMAIL
        : channel === 'WEBHOOK'
          ? NotificationChannelEnum.WEBHOOK
          : channel === 'IN_APP'
            ? NotificationChannelEnum.IN_APP
            : null,
    )
    .filter(
      (channel): channel is NotificationChannelEnum => Boolean(channel),
    );

  return channels.length ? channels : DEFAULT_TASK_CHANNELS;
}

function isChannelEnabled(
  channel: NotificationChannelEnum,
  preference: NotificationPreferenceEntity,
): boolean {
  if (channel === NotificationChannelEnum.IN_APP) {
    return preference.inAppEnabled;
  }

  if (channel === NotificationChannelEnum.EMAIL) {
    return preference.emailEnabled;
  }

  return true;
}

function createNotificationEntity({
  channel,
  input,
  repository,
}: {
  readonly channel: NotificationChannelEnum;
  readonly input: CreateNotificationInput;
  readonly repository: Repository<NotificationEntity>;
}): NotificationEntity {
  const renderedTemplate = renderNotificationTemplate({
    payload: input.payload,
    type: input.type,
  });

  return repository.create({
    body: renderedTemplate.body,
    channel,
    instanceId: input.instanceId,
    payload: input.payload,
    readAt: null,
    recipientMemberId: input.recipientMemberId,
    sentAt: new Date(),
    status: NotificationStatusEnum.SENT,
    taskId: input.taskId,
    title: renderedTemplate.title,
    type: input.type,
  });
}

function readUserTaskNode(
  instance: ApprovalInstanceEntity,
  nodeId: string,
): UserTaskNode | null {
  const node = instance.workflowSnapshot.nodes.find(
    (candidate) => candidate.id === nodeId,
  );

  return node?.type === 'userTask' ? node : null;
}
