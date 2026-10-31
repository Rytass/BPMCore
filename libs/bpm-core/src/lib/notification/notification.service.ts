import { readNodeFillableFieldKeys } from '@rytass/bpm-core-shared';
import {
  ServiceTaskNode,
  UserTaskNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import {
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  Not,
  Raw,
  Repository,
} from 'typeorm';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
} from '../calendar/business-calendar.token';
import { parseIsoDurationToMilliseconds } from '../common/iso-duration';
import { readClaimedIds, withDispatchTimeout } from '../common/outbox';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { IdentityService } from '../identity/identity.service';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { readDistinctSubmitterMemberId } from '../workflow-engine/instance-submitter';
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
import {
  DEFAULT_QUIET_HOURS_TIME_ZONE,
  isWithinQuietHours,
  resolveEmailReleaseAt,
} from './notification-schedule';
import { NotificationEntity } from './notification.entity';
import { NotificationSummaryObject } from './notification-summary.object';
import {
  NotificationChannelEnum,
  NotificationResolutionEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
  SLA_ESCALATION_DELEGATION_REASON,
} from './notification.enums';

const ACTIONABLE_NOTIFICATION_TYPES: readonly NotificationTypeEnum[] = [
  NotificationTypeEnum.TASK_ASSIGNED,
  NotificationTypeEnum.TASK_TRANSFERRED,
];
import {
  BPM_NOTIFICATION_OPTIONS,
  BPMResolvedNotificationOptions,
  DEFAULT_BPM_NOTIFICATION_OPTIONS,
} from './notification-options';
import {
  BPMNotificationObserver,
  BPM_NOTIFICATION_OBSERVER,
} from './notification-observer.token';
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

/** The most distinct ids one `markNotificationsRead` call accepts. */
export const MARK_NOTIFICATIONS_READ_LIMIT = 500;

// Full-precision `created_at` of the keyset cursor row; comparing in SQL keeps
// the microseconds a JavaScript `Date` would drop.
const NOTIFICATION_CURSOR_CREATED_AT_SQL =
  'SELECT "cursor"."created_at" FROM "notifications" "cursor" WHERE "cursor"."id" = :cursorId';

// How long the applicant's "filed by" wording may wait for the host's member
// lookup before the member id is shown instead.
const MEMBER_NAME_LOOKUP_TIMEOUT_MS = 2000;

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

  /**
   * Lists a member's in-app notifications, newest first. Rows sharing a
   * `createdAt` are ordered by `id`, so the order is total and pages never
   * swap rows at their boundary.
   *
   * Two ways to page:
   * - `page` / `pageSize` — offset paging, as before.
   * - `beforeId` — keyset paging: the rows that sort after the notification
   *   with that id (pass the last id of the previous page). The comparison
   *   runs in SQL against the stored microsecond timestamp, so it is stable
   *   while new notifications arrive. It refuses to combine with `page > 1`,
   *   and an id that is not one of the member's in-app notifications is
   *   reported as not found.
   *
   * `changedSince` returns only rows whose `updatedAt` is later than the given
   * time, and then **ignores** `includeRead` / `includeArchived`: a row that
   * was just read or archived is exactly the change a syncing host must see.
   * `updatedAt` is stamped when the writing statement runs, which can be
   * before its transaction commits, so pass a watermark a few seconds earlier
   * than the latest `updatedAt` already seen and de-duplicate by `id`.
   */
  async listNotifications({
    beforeId = null,
    changedSince = null,
    includeArchived = false,
    includeRead = false,
    page = 1,
    pageSize = 10,
    recipientMemberId,
  }: {
    readonly beforeId?: string | null;
    readonly changedSince?: Date | null;
    readonly includeArchived?: boolean;
    readonly includeRead?: boolean;
    readonly page?: number;
    readonly pageSize?: number;
    readonly recipientMemberId: string;
  }): Promise<readonly NotificationEntity[]> {
    const normalizedPageSize = normalizePageSize(pageSize);
    const cursorId = beforeId?.trim() || null;
    const tracksChanges = changedSince !== null;
    const baseWhere: FindOptionsWhere<NotificationEntity> = {
      channel: NotificationChannelEnum.IN_APP,
      recipientMemberId,
      ...(tracksChanges ? { updatedAt: MoreThan(changedSince) } : {}),
      ...(includeRead || tracksChanges
        ? {}
        : { status: Not(NotificationStatusEnum.READ) }),
      ...(includeArchived || tracksChanges ? {} : { archivedAt: IsNull() }),
    };

    if (cursorId !== null) {
      await this.assertNotificationCursor({
        cursorId,
        page,
        recipientMemberId,
      });
    }

    const notifications = await this.notificationRepository.find({
      order: { createdAt: 'DESC', id: 'DESC' },
      ...(cursorId === null
        ? { skip: (normalizePage(page) - 1) * normalizedPageSize }
        : {}),
      take: normalizedPageSize,
      where:
        cursorId === null
          ? baseWhere
          : [
              {
                ...baseWhere,
                createdAt: Raw(
                  (column) =>
                    `${column} < (${NOTIFICATION_CURSOR_CREATED_AT_SQL})`,
                  { cursorId },
                ),
              },
              {
                ...baseWhere,
                createdAt: Raw(
                  (column) =>
                    `${column} = (${NOTIFICATION_CURSOR_CREATED_AT_SQL})`,
                  { cursorId },
                ),
                id: LessThan(cursorId),
              },
            ],
    });

    return this.attachLegacyTaskPolicies(notifications);
  }

  private async assertNotificationCursor({
    cursorId,
    page,
    recipientMemberId,
  }: {
    readonly cursorId: string;
    readonly page: number;
    readonly recipientMemberId: string;
  }): Promise<void> {
    if (normalizePage(page) > 1) {
      throw new BadRequestException(
        'beforeId cannot be combined with a page after the first',
      );
    }

    const cursor = isUUID(cursorId)
      ? await this.notificationRepository.findOne({
          select: { id: true },
          where: {
            channel: NotificationChannelEnum.IN_APP,
            id: cursorId,
            recipientMemberId,
          },
        })
      : null;

    if (!cursor) {
      throw new NotFoundException(`Notification ${cursorId} was not found`);
    }
  }

  /**
   * A cheap change probe: the unread badge count plus the latest `updatedAt`
   * across all of the member's in-app notifications, read and archived ones
   * included. A host re-reads the list only when either value moved.
   */
  async readNotificationSummary(
    recipientMemberId: string,
  ): Promise<NotificationSummaryObject> {
    const [unreadCount, latest] = await Promise.all([
      this.countUnreadNotifications(recipientMemberId),
      this.notificationRepository
        .createQueryBuilder('notification')
        .select('MAX(notification.updatedAt)', 'latestUpdatedAt')
        .where('notification.channel = :channel', {
          channel: NotificationChannelEnum.IN_APP,
        })
        .andWhere('notification.recipientMemberId = :recipientMemberId', {
          recipientMemberId,
        })
        .getRawOne<{ readonly latestUpdatedAt: Date | string | null }>(),
    ]);
    const latestUpdatedAt = latest?.latestUpdatedAt ?? null;

    return Object.assign(new NotificationSummaryObject(), {
      latestUpdatedAt:
        latestUpdatedAt === null ? null : new Date(latestUpdatedAt),
      unreadCount,
    });
  }

  private async attachLegacyTaskPolicies(
    notifications: readonly NotificationEntity[],
  ): Promise<readonly NotificationEntity[]> {
    const legacyNotifications = notifications.filter(
      (notification) =>
        notification.actionable &&
        notification.taskId !== null &&
        typeof notification.payload?.allowReject !== 'boolean',
    );

    if (legacyNotifications.length === 0) {
      return notifications;
    }

    const tasks = await this.taskRepository.find({
      where: {
        id: In(
          legacyNotifications.flatMap((notification) =>
            notification.taskId === null ? [] : [notification.taskId],
          ),
        ),
      },
    });

    if (tasks.length === 0) {
      return notifications;
    }

    const instances = await this.approvalInstanceRepository.find({
      where: {
        id: In([...new Set(tasks.map((task) => task.instanceId))]),
      },
    });
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const instancesById = new Map(
      instances.map((instance) => [instance.id, instance]),
    );

    return notifications.map((notification) => {
      if (notification.taskId === null) {
        return notification;
      }

      const task = tasksById.get(notification.taskId);
      if (!task) {
        return notification;
      }

      const instance = instancesById.get(task.instanceId);
      const node = instance ? readUserTaskNode(instance, task.nodeId) : null;

      if (!node) {
        return notification;
      }

      return Object.assign(new NotificationEntity(), notification, {
        allowReject: node.data.allowReject !== false,
      });
    });
  }

  async countNotifications({
    includeArchived = false,
    includeRead = false,
    recipientMemberId,
  }: {
    readonly includeArchived?: boolean;
    readonly includeRead?: boolean;
    readonly recipientMemberId: string;
  }): Promise<number> {
    return this.notificationRepository.count({
      where: {
        channel: NotificationChannelEnum.IN_APP,
        recipientMemberId,
        ...(includeRead ? {} : { status: Not(NotificationStatusEnum.READ) }),
        ...(includeArchived ? {} : { archivedAt: IsNull() }),
      },
    });
  }

  /**
   * Drives the bell badge. Archived notifications are excluded even when still
   * unread, otherwise archiving would leave the badge lit forever.
   */
  async countUnreadNotifications(recipientMemberId: string): Promise<number> {
    return this.notificationRepository.count({
      where: {
        archivedAt: IsNull(),
        channel: NotificationChannelEnum.IN_APP,
        recipientMemberId,
        status: Not(NotificationStatusEnum.READ),
      },
    });
  }

  async markAllNotificationsRead({
    recipientMemberId,
  }: {
    readonly recipientMemberId: string;
  }): Promise<number> {
    const trimmedRecipientMemberId = recipientMemberId.trim();

    if (!trimmedRecipientMemberId) {
      return 0;
    }

    const result = await this.notificationRepository.update(
      {
        channel: NotificationChannelEnum.IN_APP,
        recipientMemberId: trimmedRecipientMemberId,
        status: Not(NotificationStatusEnum.READ),
      },
      {
        readAt: new Date(),
        status: NotificationStatusEnum.READ,
      },
    );

    return result.affected ?? 0;
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

    const saved = await this.notificationRepository.save(
      this.notificationRepository.create({
        ...notification,
        readAt: notification.readAt ?? new Date(),
        status: NotificationStatusEnum.READ,
      }),
    );

    // `updatedAt` is stamped by a trigger, so the saved entity still carries
    // the value read before the update.
    return (
      (await this.notificationRepository.findOne({ where: { id } })) ?? saved
    );
  }

  /**
   * Marks several of a member's in-app notifications read in one statement
   * and returns the ids that actually changed, in the order given.
   *
   * Ids that are blank, malformed, unknown, belong to another member, are not
   * in-app (an email row's status is its delivery state), or were already read
   * are skipped silently and are absent from the result — so the result's
   * length is the number of notifications this call turned read. The update
   * is atomic: either every listed row changes or, on error, none does. At
   * most `MARK_NOTIFICATIONS_READ_LIMIT` distinct ids per call.
   */
  async markNotificationsRead({
    ids,
    readerMemberId,
  }: {
    readonly ids: readonly string[];
    readonly readerMemberId: string;
  }): Promise<readonly string[]> {
    const trimmedReaderMemberId = readerMemberId.trim();
    // Postgres returns uuids in lowercase; normalise so the changed ids can be
    // matched back and two spellings of one id count once.
    const targetIds = [
      ...new Set(
        ids.map((id) => id.trim().toLowerCase()).filter((id) => isUUID(id)),
      ),
    ];

    if (targetIds.length > MARK_NOTIFICATIONS_READ_LIMIT) {
      throw new BadRequestException(
        `markNotificationsRead accepts at most ${MARK_NOTIFICATIONS_READ_LIMIT} ids`,
      );
    }

    if (!trimmedReaderMemberId || targetIds.length === 0) {
      return [];
    }

    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ readAt: new Date(), status: NotificationStatusEnum.READ })
      .where('id IN (:...ids)', { ids: targetIds })
      .andWhere('recipient_member_id = :recipientMemberId', {
        recipientMemberId: trimmedReaderMemberId,
      })
      .andWhere('channel = :channel', {
        channel: NotificationChannelEnum.IN_APP,
      })
      .andWhere('status <> :readStatus', {
        readStatus: NotificationStatusEnum.READ,
      })
      .returning(['id'])
      .execute();
    const changedIds = new Set(readClaimedIds(result.raw));

    return targetIds.filter((id) => changedIds.has(id));
  }

  /**
   * Archiving is an independent dimension from read state: it removes the
   * notification from the member's default list while keeping the row for
   * statistics and audits.
   */
  async archiveNotifications({
    ids,
    memberId,
  }: {
    readonly ids: readonly string[];
    readonly memberId: string;
  }): Promise<number> {
    return this.updateArchivedAt({ archivedAt: new Date(), ids, memberId });
  }

  async unarchiveNotifications({
    ids,
    memberId,
  }: {
    readonly ids: readonly string[];
    readonly memberId: string;
  }): Promise<number> {
    return this.updateArchivedAt({ archivedAt: null, ids, memberId });
  }

  private async updateArchivedAt({
    archivedAt,
    ids,
    memberId,
  }: {
    readonly archivedAt: Date | null;
    readonly ids: readonly string[];
    readonly memberId: string;
  }): Promise<number> {
    const trimmedMemberId = memberId.trim();
    const targetIds = [...new Set(ids.filter((id) => id.trim().length > 0))];

    if (!trimmedMemberId || targetIds.length === 0) {
      return 0;
    }

    const result = await this.notificationRepository.update(
      {
        archivedAt: archivedAt === null ? Not(IsNull()) : IsNull(),
        id: In(targetIds),
        recipientMemberId: trimmedMemberId,
      },
      { archivedAt },
    );

    return result.affected ?? 0;
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

    // Same prototype-preserving reason as the delegation rules: this row is
    // the `updateNotificationPreference` mutation's return value.
    return this.notificationPreferenceRepository.save(
      Object.assign(new NotificationPreferenceEntity(), currentPreference, {
        emailDigestMode: input.emailDigestMode,
        emailEnabled: input.emailEnabled,
        inAppEnabled: input.inAppEnabled,
        memberId: input.memberId,
        quietHoursEnd: normalizeTimeInput(input.quietHoursEnd),
        quietHoursStart: normalizeTimeInput(input.quietHoursStart),
      }),
    );
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
          allowReject: node.data.allowReject !== false,
          hasFillableFields:
            !task.isAdhoc && readNodeFillableFieldKeys(node).size > 0,
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
    >(
      async (
        previousPromise,
        recipientMemberId,
      ): Promise<readonly NotificationEntity[]> => {
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
      },
      Promise.resolve([]),
    );
  }

  /**
   * Deliver an ad-hoc directive notification (STAGE_NOTIFY /
   * COMPLETION_NOTIFY) to resolved member recipients. Runs inside the
   * caller's transaction `manager` so it commits atomically with the
   * workflow state change that triggered it.
   */
  async createAdhocWorkflowNotifications({
    channels,
    instance,
    manager,
    message,
    payload,
    recipientMemberIds,
  }: {
    readonly channels: readonly NotificationChannelEnum[] | null;
    readonly instance: ApprovalInstanceEntity;
    readonly manager: EntityManager;
    readonly message: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly recipientMemberIds: readonly string[];
  }): Promise<readonly NotificationEntity[]> {
    const normalizedChannels = channels?.length
      ? channels
      : [NotificationChannelEnum.IN_APP];
    const uniqueRecipientMemberIds = uniqueStrings(recipientMemberIds);

    return uniqueRecipientMemberIds.reduce<
      Promise<readonly NotificationEntity[]>
    >(
      async (
        previousPromise,
        recipientMemberId,
      ): Promise<readonly NotificationEntity[]> => {
        const previous = await previousPromise;
        const created = await this.createNotifications(
          {
            channels: normalizedChannels,
            instanceId: instance.id,
            payload: {
              ...payload,
              instanceId: instance.id,
              instanceTitle: instance.title,
              message,
              recipientMemberId,
            },
            recipientMemberId,
            taskId: null,
            type: NotificationTypeEnum.WORKFLOW_NOTIFICATION,
          },
          manager,
        );

        return [...previous, ...created];
      },
      Promise.resolve([]),
    );
  }

  async createInstanceCompletedNotification({
    instance,
    manager,
  }: {
    readonly instance: ApprovalInstanceEntity;
    readonly manager: EntityManager;
  }): Promise<readonly NotificationEntity[]> {
    const repository = manager.getRepository(NotificationEntity);
    const existingNotification = await repository.findOne({
      where: {
        channel: NotificationChannelEnum.IN_APP,
        instanceId: instance.id,
        recipientMemberId: instance.initiatorMemberId,
        taskId: IsNull(),
        type: NotificationTypeEnum.INSTANCE_COMPLETED,
      },
    });

    if (existingNotification) {
      return [];
    }

    // The applicant is told who filed the document for them. Nothing is added
    // when they submitted it themselves, so those payloads stay as they were.
    const submitterMemberId = readDistinctSubmitterMemberId(instance);
    const submitterPayload = submitterMemberId
      ? {
          submittedByMemberId: submitterMemberId,
          submittedByNote: `（由 ${await this.readRecordedSubmitterName(
            manager,
            instance.id,
            submitterMemberId,
          )} 代為送出）`,
        }
      : {};

    return this.createNotifications(
      {
        channels: [NotificationChannelEnum.IN_APP],
        instanceId: instance.id,
        payload: {
          completedAt: instance.completedAt?.toISOString() ?? null,
          instanceId: instance.id,
          instanceTitle: instance.title,
          recipientMemberId: instance.initiatorMemberId,
          ...submitterPayload,
        },
        recipientMemberId: instance.initiatorMemberId,
        taskId: null,
        type: NotificationTypeEnum.INSTANCE_COMPLETED,
      },
      manager,
    );
  }

  /**
   * Resolve the open task-assignment notifications for a decided task, so the
   * inline 同意/拒絕 actions stop being offered once the task no longer needs
   * the recipient. The acting member's notification records the actual
   * decision (`resolution`); every other candidate's notification is marked
   * `SUPERSEDED` when the task has ended. Runs inside the caller's
   * transaction `manager` so it commits atomically with the decision.
   */
  async resolveTaskNotifications({
    actingMemberId,
    manager,
    resolution,
    supersedeOthers,
    taskId,
  }: {
    readonly actingMemberId: string;
    readonly manager: EntityManager;
    readonly resolution: NotificationResolutionEnum;
    readonly supersedeOthers: boolean;
    readonly taskId: string;
  }): Promise<void> {
    const repository = manager.getRepository(NotificationEntity);
    const resolvedAt = new Date();

    await repository.update(
      {
        recipientMemberId: actingMemberId,
        resolvedAt: IsNull(),
        taskId,
        type: In(ACTIONABLE_NOTIFICATION_TYPES),
      },
      {
        readAt: resolvedAt,
        resolution,
        resolvedAt,
        status: NotificationStatusEnum.READ,
      },
    );

    if (supersedeOthers) {
      await repository.update(
        {
          recipientMemberId: Not(actingMemberId),
          resolvedAt: IsNull(),
          taskId,
          type: In(ACTIONABLE_NOTIFICATION_TYPES),
        },
        {
          readAt: resolvedAt,
          resolution: NotificationResolutionEnum.SUPERSEDED,
          resolvedAt,
          status: NotificationStatusEnum.READ,
        },
      );
    }
  }

  /**
   * Mark every still-open task-assignment notification for an instance as
   * `SUPERSEDED` — used when the whole instance is cancelled, so lingering
   * "待簽" notifications can no longer be actioned. Runs inside the caller's
   * transaction `manager`.
   */
  async supersedeInstanceTaskNotifications({
    instanceId,
    manager,
  }: {
    readonly instanceId: string;
    readonly manager: EntityManager;
  }): Promise<void> {
    const repository = manager.getRepository(NotificationEntity);
    const resolvedAt = new Date();

    await repository.update(
      {
        instanceId,
        resolvedAt: IsNull(),
        type: In(ACTIONABLE_NOTIFICATION_TYPES),
      },
      {
        readAt: resolvedAt,
        resolution: NotificationResolutionEnum.SUPERSEDED,
        resolvedAt,
        status: NotificationStatusEnum.READ,
      },
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

        if (!(await this.tryClaimSlaTask(task.id))) {
          return currentResult;
        }

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

        const slaStartTime = (task.slaStartedAt ?? task.createdAt).getTime();
        const warningAtTime =
          slaStartTime + (task.slaDueAt.getTime() - slaStartTime) * warningAt;

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

  private async tryClaimSlaTask(taskId: string): Promise<boolean> {
    if (!this.taskRepository.query) {
      return true;
    }

    const rows = (await this.taskRepository.query(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS claimed',
      [`bpm-sla:${taskId}`],
    )) as readonly { readonly claimed?: boolean }[];

    return rows[0]?.claimed !== false;
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

      try {
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
      } catch (error: unknown) {
        if (isUniqueConstraintViolation(error)) {
          return count;
        }

        throw error;
      }

      return count + 1;
    }, Promise.resolve(0));

    return createdNotifications > 0;
  }

  private async createNotifications(
    input: CreateNotificationInput,
    manager?: EntityManager,
    now: Date = new Date(),
  ): Promise<readonly NotificationEntity[]> {
    const preference = await this.getPreference(input.recipientMemberId);
    const repository = manager
      ? manager.getRepository(NotificationEntity)
      : this.notificationRepository;
    const quietHoursTimeZone = this.readQuietHoursTimeZone();
    const notifications = input.channels.flatMap((channel) => {
      const delivery = resolveChannelDelivery({
        at: now,
        channel,
        options: this.notificationOptions,
        preference,
        quietHoursTimeZone,
      });

      return delivery.record
        ? [
            createNotificationEntity({
              channel,
              input,
              now,
              options: this.notificationOptions,
              releaseAt: delivery.releaseAt,
              repository,
              silenced: delivery.silenced,
            }),
          ]
        : [];
    });

    if (notifications.length === 0) {
      return [];
    }

    const savedNotifications = await repository.save(notifications);

    await Promise.all(
      savedNotifications
        .filter(
          (notification) =>
            notification.channel !== NotificationChannelEnum.IN_APP &&
            // A row held for quiet hours or a daily digest carries its release
            // instant in `nextRetryAt`; the delivery scan is what picks it up
            // once that instant passes.
            notification.nextRetryAt === null,
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

    await this.notifyObserver(input, savedNotifications, manager);

    return savedNotifications;
  }

  /**
   * Tells a host-provided observer about rows that were just written, for
   * every channel — `IN_APP` included, which the delivery path skips because
   * it has nothing to deliver.
   *
   * Errors are logged and dropped: this runs inside whatever transaction the
   * engine is in, and a host's realtime push must not be able to roll back an
   * approval.
   */
  private async notifyObserver(
    input: CreateNotificationInput,
    notifications: readonly NotificationEntity[],
    manager?: EntityManager,
  ): Promise<void> {
    const observer = this.readHostObserver();

    if (!observer) {
      return;
    }

    try {
      await observer.onNotificationsCreated({
        instanceId: input.instanceId,
        notifications,
        taskId: input.taskId,
        type: input.type,
        ...(manager ? { manager } : {}),
      });
    } catch (error: unknown) {
      this.logger.error(
        `BPM_NOTIFICATION_OBSERVER failed for ${notifications.length} notification(s)`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * The zone the recipients' bare `HH:mm` quiet-hours preferences are read in.
   *
   * Falls back to the registered business calendar rather than to UTC: the
   * calendar already states where the host's people are, and a host that
   * supplied one would otherwise get quiet hours silently offset by its whole
   * UTC offset. Resolved here rather than in the flattened options because the
   * calendar is a DI provider that does not exist at wiring time.
   */
  private readQuietHoursTimeZone(): string {
    if (this.notificationOptions.quietHoursTimeZone) {
      return this.notificationOptions.quietHoursTimeZone;
    }

    try {
      return this.moduleRef.get<BPMBusinessCalendar>(BPM_BUSINESS_CALENDAR, {
        strict: false,
      }).timeZone;
    } catch {
      return DEFAULT_QUIET_HOURS_TIME_ZONE;
    }
  }

  /**
   * The submitter's name as the engine recorded it on `INSTANCE_STARTED`
   * (`submittedByName`), or the member id when it was not recorded. This runs
   * inside the approval transaction, so it reads the row instead of asking
   * the identity source and holding the instance's locks while it answers.
   */
  private async readRecordedSubmitterName(
    manager: EntityManager,
    instanceId: string,
    submitterMemberId: string,
  ): Promise<string> {
    const started = await manager.getRepository(ActivityLogEntity).findOne({
      order: { seq: 'ASC' },
      where: {
        eventType: ActivityLogEventTypeEnum.INSTANCE_STARTED,
        instanceId,
      },
    });
    const recordedName = started?.payload?.['submittedByName'];

    return typeof recordedName === 'string' && recordedName.trim()
      ? recordedName
      : submitterMemberId;
  }

  /**
   * The name a member goes by in notification text, resolved through the host
   * identity source like the email recipient is. Falls back to the id when
   * the identity source fails or does not answer within
   * {@link MEMBER_NAME_LOOKUP_TIMEOUT_MS}. Call it outside any transaction:
   * the engine resolves the submitter's name this way before a submit opens
   * one, so wording a notification never holds an approval's locks.
   */
  async readMemberDisplayName(memberId: string): Promise<string> {
    try {
      const member = await withDispatchTimeout(
        this.moduleRef
          .get(IdentityService, { strict: false })
          .resolveMember(memberId),
        MEMBER_NAME_LOOKUP_TIMEOUT_MS,
      );

      return member.name.trim() || memberId;
    } catch {
      return memberId;
    }
  }

  private readHostObserver(): BPMNotificationObserver | null {
    try {
      return this.moduleRef.get(BPM_NOTIFICATION_OBSERVER, { strict: false });
    } catch {
      return null;
    }
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

      // Marked so a later "who actually signed" node does not count a
      // timeout as someone's approval.
      await workflowEngine.decideTask(
        {
          action: TaskDecisionActionEnum.APPROVED,
          comment: 'SLA timeout auto-approved this task.',
          decidedByMemberId: actorMemberId,
          taskId: task.id,
        },
        { automatic: 'SLA_AUTO_APPROVE' },
      );

      return;
    }

    if (timeoutAction === 'ESCALATE') {
      // Escalation moves the work onto a new task that keeps the (already
      // elapsed) due date, so without this guard the next scan would escalate
      // it again, one management level per scan.
      if (hasSlaEscalationStep(task)) {
        this.logger.log(
          `SLA escalation already applied for task ${task.id}; skipping.`,
        );

        return;
      }

      const actorMemberId = await this.resolveTaskActorMemberId(task);
      const targetMemberId = await this.resolveEscalationTargetMemberId({
        actorMemberId,
        node,
      });

      if (!targetMemberId || targetMemberId === actorMemberId) {
        this.logger.warn(`SLA escalation skipped for task ${task.id}`);

        return;
      }

      await workflowEngine.decideTask(
        {
          action: TaskDecisionActionEnum.TRANSFERRED,
          comment: 'SLA timeout escalated this task.',
          decidedByMemberId: actorMemberId,
          taskId: task.id,
          transferToMemberId: targetMemberId,
        },
        { transferReason: SLA_ESCALATION_DELEGATION_REASON },
      );

      return;
    }

    // EXPIRED, not CANCELLED: nobody cancelled it, and borrowing the
    // initiator's identity (which cancelling requires) put their name on it.
    await workflowEngine.expireApprovalInstance({
      comment: 'SLA timeout terminated this instance.',
      instanceId: instance.id,
      nodeId: node.id,
      taskId: task.id,
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

/**
 * Adds a node's SLA duration to `now` as plain elapsed time.
 *
 * @deprecated Since 0.7.0 the engine schedules through
 * `BPMSlaScheduleService.resolveTaskSlaDueAt`, which additionally honours
 * `SlaConfig.calendar: 'BUSINESS_DAY'`. This function is kept for hosts that
 * called it directly and always behaves as `CALENDAR` mode.
 */
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

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

interface ChannelDelivery {
  /**
   * When the row may go out, or `null` for "immediately". Only ever set for
   * the delivered channels; written to `nextRetryAt`.
   */
  readonly releaseAt: Date | null;
  /** Whether BPM writes a row for this channel at all. */
  readonly record: boolean;
  /** Whether the recorded row is deliberately not announced. */
  readonly silenced: boolean;
}

/**
 * Splits a channel's fate into "is it recorded" and "is it announced", which
 * `inAppEnabled` used to conflate.
 *
 * The member preference decides announcement. Recording is the host's call:
 * `options.inAppEnabled` is a wiring-level switch for running BPM without
 * notification-centre data at all, not something a member can trip. Email and
 * webhook have no BPM-side record to lose, so for them the two answers stay
 * the same — except in time, where quiet hours and the daily digest push
 * delivery later rather than dropping it.
 */
function resolveChannelDelivery({
  at,
  channel,
  options,
  preference,
  quietHoursTimeZone,
}: {
  readonly at: Date;
  readonly channel: NotificationChannelEnum;
  readonly options: BPMResolvedNotificationOptions;
  readonly preference: NotificationPreferenceEntity;
  readonly quietHoursTimeZone: string;
}): ChannelDelivery {
  const quietHours = {
    quietHoursEnd: preference.quietHoursEnd,
    quietHoursStart: preference.quietHoursStart,
    timeZone: quietHoursTimeZone,
  };

  if (channel === NotificationChannelEnum.IN_APP) {
    return {
      releaseAt: null,
      record: options.inAppEnabled,
      silenced: !preference.inAppEnabled || isWithinQuietHours(at, quietHours),
    };
  }

  if (channel === NotificationChannelEnum.EMAIL) {
    const record = options.emailEnabled && preference.emailEnabled;

    return {
      releaseAt: record
        ? resolveEmailReleaseAt(at, {
            ...quietHours,
            digestHour: options.emailDigestHour,
            digestMode: preference.emailDigestMode,
          })
        : null,
      record,
      silenced: false,
    };
  }

  return {
    releaseAt: null,
    record: options.webhookEnabled,
    silenced: false,
  };
}

function hasSlaEscalationStep(task: TaskEntity): boolean {
  return task.delegationChain.some(
    (step) => step['reason'] === SLA_ESCALATION_DELEGATION_REASON,
  );
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
  now,
  options,
  releaseAt,
  repository,
  silenced,
}: {
  readonly channel: NotificationChannelEnum;
  readonly input: CreateNotificationInput;
  readonly now: Date;
  readonly options: BPMResolvedNotificationOptions;
  readonly releaseAt: Date | null;
  readonly repository: Repository<NotificationEntity>;
  readonly silenced: boolean;
}): NotificationEntity {
  const renderedTemplate = renderNotificationTemplate({
    customTemplate: input.customTemplate,
    engine: options.templateEngine,
    payload: input.payload,
    type: input.type,
  });
  const isInApp = channel === NotificationChannelEnum.IN_APP;

  return repository.create({
    allowReject:
      typeof input.payload.allowReject === 'boolean'
        ? input.payload.allowReject
        : null,
    attemptCount: 0,
    body: renderedTemplate.body,
    channel,
    // An in-app row is "delivered" the moment it exists, silenced or not:
    // what silencing withholds is the announcement, not the record.
    deliveredAt: isInApp ? now : null,
    deliveryError: null,
    deliveryTarget: null,
    instanceId: input.instanceId,
    lastAttemptAt: null,
    nextRetryAt: releaseAt,
    payload: input.payload,
    readAt: null,
    recipientMemberId: input.recipientMemberId,
    resolution: null,
    resolvedAt: null,
    sentAt: isInApp ? now : null,
    silenced,
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
