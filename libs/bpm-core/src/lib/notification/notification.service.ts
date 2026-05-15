import {
  ServiceTaskNode,
  UserTaskNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
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
import { OrganizationService } from '../organization/organization.service';
import { TaskCandidateEntity } from '../workflow-engine/task-candidate.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import {
  BPM_WORKFLOW_ENGINE_SERVICE,
  BPMWorkflowEngineService,
} from '../workflow-engine/workflow-engine.tokens';
import {
  ActivityLogEventTypeEnum,
  TaskDecisionActionEnum,
  TaskCandidateStatusEnum,
  TaskStatusEnum,
} from '../workflow-engine/workflow-engine.enums';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import {
  NotificationChannelEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
} from './notification.enums';
import {
  BPM_NOTIFICATION_OPTIONS,
  BPMResolvedNotificationOptions,
  DEFAULT_BPM_NOTIFICATION_OPTIONS,
} from './notification-options';
import { renderNotificationTemplate } from './notification-template';
import { UpdateNotificationPreferenceInput } from './dto/notification-preference.input';

interface CreateNotificationInput {
  readonly channels: readonly NotificationChannelEnum[];
  readonly instanceId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recipientMemberId: string;
  readonly taskId: string | null;
  readonly type: NotificationTypeEnum;
  readonly customTemplate?: string | null;
}

interface SlaScanResult {
  readonly overdueCount: number;
  readonly warningCount: number;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(NotificationPreferenceEntity)
    private readonly notificationPreferenceRepository: Repository<NotificationPreferenceEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
    @InjectRepository(TaskCandidateEntity)
    private readonly taskCandidateRepository: Repository<TaskCandidateEntity>,
    @InjectRepository(ApprovalInstanceEntity)
    private readonly approvalInstanceRepository: Repository<ApprovalInstanceEntity>,
    @InjectRepository(ActivityLogEntity)
    private readonly activityLogRepository: Repository<ActivityLogEntity>,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(BPM_NOTIFICATION_OPTIONS)
    private readonly notificationOptions: BPMResolvedNotificationOptions = DEFAULT_BPM_NOTIFICATION_OPTIONS,
  ) {}

  async listNotifications({
    includeRead = false,
    page = 1,
    pageSize = 10,
    recipientMemberId,
  }: {
    readonly includeRead?: boolean;
    readonly page?: number;
    readonly pageSize?: number;
    readonly recipientMemberId: string;
  }): Promise<readonly NotificationEntity[]> {
    const normalizedPageSize = normalizePageSize(pageSize);

    return this.notificationRepository.find({
      order: { createdAt: 'DESC' },
      skip: (normalizePage(page) - 1) * normalizedPageSize,
      take: normalizedPageSize,
      where: {
        channel: NotificationChannelEnum.IN_APP,
        recipientMemberId,
        ...(includeRead ? {} : { status: Not(NotificationStatusEnum.READ) }),
      },
    });
  }

  async countNotifications({
    includeRead = false,
    recipientMemberId,
  }: {
    readonly includeRead?: boolean;
    readonly recipientMemberId: string;
  }): Promise<number> {
    return this.notificationRepository.count({
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

    return this.notificationRepository.save(
      this.notificationRepository.create({
        ...notification,
        readAt: notification.readAt ?? new Date(),
        status: NotificationStatusEnum.READ,
      }),
    );
  }

  async getPreference(memberId: string): Promise<NotificationPreferenceEntity> {
    const existingPreference =
      await this.notificationPreferenceRepository.findOne({
        where: { memberId },
      });

    return (
      existingPreference ??
      createDefaultPreference(memberId, this.notificationOptions)
    );
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
    if (!task.assigneeMemberId) {
      return [];
    }

    return this.createNotifications(
      {
        channels: readNodeNotificationChannels(node, this.notificationOptions),
        customTemplate: node.data.notification?.customTemplate ?? null,
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

  async createServiceTaskNotifications({
    instance,
    manager,
    node,
    recipientMemberIds,
  }: {
    readonly instance: ApprovalInstanceEntity;
    readonly manager: EntityManager;
    readonly node: ServiceTaskNode;
    readonly recipientMemberIds: readonly string[];
  }): Promise<readonly NotificationEntity[]> {
    if (node.data.action.type !== 'NOTIFY') {
      return [];
    }

    const action = node.data.action;
    const channels = normalizeNotificationChannels(action.channels);
    const uniqueRecipientMemberIds = uniqueStrings(recipientMemberIds);

    return uniqueRecipientMemberIds.reduce<
      Promise<readonly NotificationEntity[]>
    >(async (previousPromise, recipientMemberId): Promise<
      readonly NotificationEntity[]
    > => {
      const previous = await previousPromise;
      const created = await this.createNotifications(
        {
          channels,
          customTemplate: action.template ?? null,
          instanceId: instance.id,
          payload: {
            instanceId: instance.id,
            instanceTitle: instance.title,
            message:
              action.template ??
              `案件 ${instance.title} 的 ${node.data.label} 已送出通知。`,
            nodeId: node.id,
            nodeLabel: node.data.label,
            recipientMemberId,
          },
          recipientMemberId,
          taskId: null,
          type: NotificationTypeEnum.WORKFLOW_NOTIFICATION,
        },
        manager,
      );

      return [...previous, ...created];
    }, Promise.resolve([]));
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
            await this.runSlaTimeoutHook({ instance, node, task });
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
    readonly type:
      | NotificationTypeEnum.SLA_OVERDUE
      | NotificationTypeEnum.SLA_WARNING;
  }): Promise<boolean> {
    const recipientMemberIds = await this.resolveTaskRecipientMemberIds(task);

    if (recipientMemberIds.length === 0) {
      return false;
    }

    const createdNotifications = await recipientMemberIds.reduce<
      Promise<number>
    >(async (countPromise, recipientMemberId): Promise<number> => {
      const count = await countPromise;
      const existingNotification = await this.notificationRepository.findOne({
        where: {
          channel: NotificationChannelEnum.IN_APP,
          recipientMemberId,
          taskId: task.id,
          type,
        },
      });

      if (existingNotification) {
        return count;
      }

      await this.createNotifications({
        channels: [NotificationChannelEnum.IN_APP],
        customTemplate: node.data.notification?.customTemplate ?? null,
        instanceId: instance.id,
        payload: {
          assigneeMemberId: task.assigneeMemberId,
          instanceId: instance.id,
          instanceTitle: instance.title,
          nodeId: node.id,
          nodeLabel: node.data.label,
          onTimeout: node.data.sla?.onTimeout ?? 'REMIND',
          recipientMemberId,
          slaDueAt: task.slaDueAt?.toISOString() ?? null,
          taskId: task.id,
        },
        recipientMemberId,
        taskId: task.id,
        type,
      });

      return count + 1;
    }, Promise.resolve(0));

    return createdNotifications > 0;
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
      isChannelEnabled(channel, preference, this.notificationOptions)
        ? [
            createNotificationEntity({
              channel,
              input,
              options: this.notificationOptions,
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
        .filter(
          (notification) =>
            notification.channel !== NotificationChannelEnum.IN_APP,
        )
        .map((notification) =>
          manager
            ? Promise.resolve(false)
            : this.deliveryService.deliverNotification(
                notification,
                this.notificationOptions,
              ),
        ),
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

  private async runSlaTimeoutHook({
    instance,
    node,
    task,
  }: {
    readonly instance: ApprovalInstanceEntity;
    readonly node: UserTaskNode;
    readonly task: TaskEntity;
  }): Promise<void> {
    const timeoutAction = node.data.sla?.onTimeout ?? 'REMIND';

    if (!isSlaTimeoutActionEnabled(timeoutAction, this.notificationOptions)) {
      return;
    }

    await this.executeSlaTimeoutAction({
      instance,
      node,
      task,
      timeoutAction,
    });
  }

  private async executeSlaTimeoutAction({
    instance,
    node,
    task,
    timeoutAction,
  }: {
    readonly instance: ApprovalInstanceEntity;
    readonly node: UserTaskNode;
    readonly task: TaskEntity;
    readonly timeoutAction: NonNullable<
      UserTaskNode['data']['sla']
    >['onTimeout'];
  }): Promise<void> {
    if (timeoutAction === 'REMIND') {
      this.logger.log(`SLA reminder processed for task ${task.id}`);

      return;
    }

    const workflowEngine = this.moduleRef.get<BPMWorkflowEngineService>(
      BPM_WORKFLOW_ENGINE_SERVICE,
      { strict: false },
    );

    if (timeoutAction === 'AUTO_APPROVE') {
      const actorMemberId = await this.resolveTaskActorMemberId(task);

      await workflowEngine.decideTask({
        action: TaskDecisionActionEnum.APPROVED,
        comment: 'SLA timeout auto-approved this task.',
        decidedByMemberId: actorMemberId,
        taskId: task.id,
      });

      return;
    }

    if (timeoutAction === 'ESCALATE') {
      const actorMemberId = await this.resolveTaskActorMemberId(task);
      const targetMemberId = await this.resolveEscalationTargetMemberId({
        actorMemberId,
        node,
      });

      if (!targetMemberId || targetMemberId === actorMemberId) {
        this.logger.warn(`SLA escalation skipped for task ${task.id}`);

        return;
      }

      await workflowEngine.decideTask({
        action: TaskDecisionActionEnum.TRANSFERRED,
        comment: 'SLA timeout escalated this task.',
        decidedByMemberId: actorMemberId,
        taskId: task.id,
        transferToMemberId: targetMemberId,
      });

      return;
    }

    await workflowEngine.cancelApprovalInstance({
      cancelledByMemberId: instance.initiatorMemberId,
      comment: 'SLA timeout terminated this instance.',
      instanceId: instance.id,
    });
  }

  private async resolveTaskActorMemberId(task: TaskEntity): Promise<string> {
    if (task.assigneeMemberId) {
      return task.assigneeMemberId;
    }

    const candidate = await this.taskCandidateRepository.findOne({
      order: { createdAt: 'ASC' },
      where: { taskId: task.id },
    });

    if (!candidate) {
      throw new NotFoundException(`Task ${task.id} has no actor candidate`);
    }

    return candidate.memberId;
  }

  private async resolveTaskRecipientMemberIds(
    task: TaskEntity,
  ): Promise<readonly string[]> {
    if (task.assigneeMemberId) {
      return [task.assigneeMemberId];
    }

    const candidates = await this.taskCandidateRepository.find({
      order: { createdAt: 'ASC' },
      where: { taskId: task.id },
    });

    return uniqueStrings(
      candidates
        .filter(
          (candidate) =>
            candidate.status === TaskCandidateStatusEnum.PENDING ||
            candidate.status === TaskCandidateStatusEnum.CLAIMED,
        )
        .map((candidate) => candidate.memberId),
    );
  }

  private async resolveEscalationTargetMemberId({
    actorMemberId,
    node,
  }: {
    readonly actorMemberId: string;
    readonly node: UserTaskNode;
  }): Promise<string | null> {
    const organizationService = this.moduleRef.get(OrganizationService, {
      strict: false,
    });
    const levelsUp = Math.max(node.data.sla?.escalateLevelsUp ?? 1, 1);
    let currentMemberId: string | null = actorMemberId;

    for (let level = 0; level < levelsUp && currentMemberId; level += 1) {
      currentMemberId =
        await organizationService.resolveManagerMemberId(currentMemberId);
    }

    return currentMemberId;
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
  options: BPMResolvedNotificationOptions,
): NotificationPreferenceEntity {
  return Object.assign(new NotificationPreferenceEntity(), {
    emailDigestMode: options.defaultEmailDigestMode,
    emailEnabled: options.defaultEmailPreferenceEnabled,
    inAppEnabled: options.defaultInAppPreferenceEnabled,
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
  options: BPMResolvedNotificationOptions,
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
    .filter((channel): channel is NotificationChannelEnum => Boolean(channel));

  return channels.length ? channels : options.defaultChannels;
}

function normalizeNotificationChannels(
  channels: readonly string[],
): readonly NotificationChannelEnum[] {
  const normalizedChannels = channels
    .map((channel): NotificationChannelEnum | null =>
      channel === NotificationChannelEnum.EMAIL
        ? NotificationChannelEnum.EMAIL
        : channel === NotificationChannelEnum.IN_APP
          ? NotificationChannelEnum.IN_APP
          : null,
    )
    .filter((channel): channel is NotificationChannelEnum => Boolean(channel));

  return normalizedChannels.length
    ? normalizedChannels
    : [NotificationChannelEnum.IN_APP];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}

function isChannelEnabled(
  channel: NotificationChannelEnum,
  preference: NotificationPreferenceEntity,
  options: BPMResolvedNotificationOptions,
): boolean {
  if (channel === NotificationChannelEnum.IN_APP) {
    return options.inAppEnabled && preference.inAppEnabled;
  }

  if (channel === NotificationChannelEnum.EMAIL) {
    return options.emailEnabled && preference.emailEnabled;
  }

  return options.webhookEnabled;
}

function isSlaTimeoutActionEnabled(
  action: NonNullable<UserTaskNode['data']['sla']>['onTimeout'],
  options: BPMResolvedNotificationOptions,
): boolean {
  if (action === 'AUTO_APPROVE') {
    return options.slaTimeoutAutoApproveEnabled;
  }

  if (action === 'ESCALATE') {
    return options.slaTimeoutEscalateEnabled;
  }

  if (action === 'TERMINATE_INSTANCE') {
    return options.slaTimeoutTerminateInstanceEnabled;
  }

  return options.slaTimeoutRemindEnabled;
}

function createNotificationEntity({
  channel,
  input,
  options,
  repository,
}: {
  readonly channel: NotificationChannelEnum;
  readonly input: CreateNotificationInput;
  readonly options: BPMResolvedNotificationOptions;
  readonly repository: Repository<NotificationEntity>;
}): NotificationEntity {
  const renderedTemplate = renderNotificationTemplate({
    customTemplate: input.customTemplate,
    engine: options.templateEngine,
    payload: input.payload,
    type: input.type,
  });
  const isInApp = channel === NotificationChannelEnum.IN_APP;

  return repository.create({
    attemptCount: 0,
    body: renderedTemplate.body,
    channel,
    deliveredAt: isInApp ? new Date() : null,
    deliveryError: null,
    deliveryTarget: null,
    instanceId: input.instanceId,
    lastAttemptAt: null,
    nextRetryAt: null,
    payload: input.payload,
    readAt: null,
    recipientMemberId: input.recipientMemberId,
    sentAt: isInApp ? new Date() : null,
    status: isInApp
      ? NotificationStatusEnum.SENT
      : NotificationStatusEnum.PENDING,
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

function normalizePage(page: number): number {
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function normalizePageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize)) {
    return 10;
  }

  return Math.min(Math.max(pageSize, 1), 100);
}
