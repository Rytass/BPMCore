import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  FindOperator,
  IsNull,
  MoreThan,
  Not,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskCandidateEntity } from '../workflow-engine/task-candidate.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import {
  NotificationChannelEnum,
  NotificationStatusEnum,
} from './notification.enums';
import {
  MARK_NOTIFICATIONS_READ_LIMIT,
  NotificationService,
} from './notification.service';

const CURSOR_ID = '6f1c1f43-6a43-4f43-9d55-2c1f4b8f0001';
const OTHER_ID = '6f1c1f43-6a43-4f43-9d55-2c1f4b8f0002';

interface FindOptions {
  readonly order?: Record<string, string>;
  readonly skip?: number;
  readonly take?: number;
  readonly where: Record<string, unknown> | readonly Record<string, unknown>[];
}

interface QueryBuilderCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

function createService(
  notificationRepository: Partial<
    Record<keyof Repository<NotificationEntity>, unknown>
  >,
): NotificationService {
  return new NotificationService(
    notificationRepository as unknown as Repository<NotificationEntity>,
    createRepository<NotificationPreferenceEntity>(),
    createRepository<TaskEntity>(),
    createRepository<TaskCandidateEntity>(),
    createRepository<ApprovalInstanceEntity>(),
    createRepository<ActivityLogEntity>(),
    {} as unknown as NotificationDeliveryService,
    {} as unknown as ModuleRef,
  );
}

function createRepository<
  TEntity extends ObjectLiteral,
>(): Repository<TEntity> {
  return {
    find: (): Promise<readonly TEntity[]> => Promise.resolve([]),
  } as unknown as Repository<TEntity>;
}

/** A chainable query-builder stub that records every call it receives. */
function createQueryBuilderStub(result: {
  readonly execute?: unknown;
  readonly getRawOne?: unknown;
}): {
  readonly calls: QueryBuilderCall[];
  readonly createQueryBuilder: jest.Mock;
} {
  const calls: QueryBuilderCall[] = [];
  const builder: Record<string, (...args: readonly unknown[]) => unknown> = {};
  const chain =
    (method: string) =>
    (...args: readonly unknown[]): unknown => {
      calls.push({ args, method });

      return builder;
    };

  ['andWhere', 'returning', 'select', 'set', 'update', 'where'].forEach(
    (method): void => {
      builder[method] = chain(method);
    },
  );
  builder.execute = (): Promise<unknown> => Promise.resolve(result.execute);
  builder.getRawOne = (): Promise<unknown> => Promise.resolve(result.getRawOne);

  return { calls, createQueryBuilder: jest.fn(() => builder) };
}

describe('NotificationService listing order and keyset paging', () => {
  it('breaks createdAt ties by id so offset pages are stable', async (): Promise<void> => {
    const find = jest.fn<Promise<readonly NotificationEntity[]>, [FindOptions]>(
      () => Promise.resolve([]),
    );
    const service = createService({ find });

    await service.listNotifications({ recipientMemberId: 'member-001' });

    expect(find.mock.calls[0][0].order).toEqual({
      createdAt: 'DESC',
      id: 'DESC',
    });
  });

  it('pages after the cursor row without an offset', async (): Promise<void> => {
    const find = jest.fn<Promise<readonly NotificationEntity[]>, [FindOptions]>(
      () => Promise.resolve([]),
    );
    const findOne = jest.fn(() => Promise.resolve({ id: CURSOR_ID }));
    const service = createService({ find, findOne });

    await service.listNotifications({
      beforeId: ` ${CURSOR_ID} `,
      pageSize: 20,
      recipientMemberId: 'member-001',
    });

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channel: NotificationChannelEnum.IN_APP,
          id: CURSOR_ID,
          recipientMemberId: 'member-001',
        },
      }),
    );

    const options = find.mock.calls[0][0];

    expect(options).not.toHaveProperty('skip');
    expect(options.take).toBe(20);
    expect(Array.isArray(options.where)).toBe(true);

    const [older, sameInstant] = options.where as readonly Record<
      string,
      unknown
    >[];
    const olderCreatedAt = older.createdAt as FindOperator<unknown>;
    const sameCreatedAt = sameInstant.createdAt as FindOperator<unknown>;

    // Both branches keep the default filters and compare against the cursor
    // row's stored timestamp in SQL, never a JavaScript Date.
    expect(older).toMatchObject({
      archivedAt: IsNull(),
      recipientMemberId: 'member-001',
      status: Not(NotificationStatusEnum.READ),
    });
    expect(olderCreatedAt.type).toBe('raw');
    expect(olderCreatedAt.objectLiteralParameters).toEqual({
      cursorId: CURSOR_ID,
    });
    expect(sameCreatedAt.type).toBe('raw');
    expect((sameInstant.id as FindOperator<unknown>).type).toBe('lessThan');
    expect((sameInstant.id as FindOperator<unknown>).value).toBe(CURSOR_ID);
  });

  it('refuses a cursor combined with a later page', async (): Promise<void> => {
    const find = jest.fn();
    const service = createService({ find });

    await expect(
      service.listNotifications({
        beforeId: CURSOR_ID,
        page: 2,
        recipientMemberId: 'member-001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(find).not.toHaveBeenCalled();
  });

  it('reports a cursor that is not one of the member notifications as not found', async (): Promise<void> => {
    const find = jest.fn();
    const findOne = jest.fn(() => Promise.resolve(null));
    const service = createService({ find, findOne });

    await expect(
      service.listNotifications({
        beforeId: CURSOR_ID,
        recipientMemberId: 'member-001',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.listNotifications({
        beforeId: 'not-a-uuid',
        recipientMemberId: 'member-001',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // A malformed id never reaches the database.
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(find).not.toHaveBeenCalled();
  });

  it('returns changed rows including read and archived ones when changedSince is given', async (): Promise<void> => {
    const find = jest.fn<Promise<readonly NotificationEntity[]>, [FindOptions]>(
      () => Promise.resolve([]),
    );
    const service = createService({ find });
    const changedSince = new Date('2026-10-18T00:00:00.000Z');

    await service.listNotifications({
      changedSince,
      recipientMemberId: 'member-001',
    });

    const where = find.mock.calls[0][0].where as Record<string, unknown>;

    expect(where).toMatchObject({
      channel: NotificationChannelEnum.IN_APP,
      recipientMemberId: 'member-001',
      updatedAt: MoreThan(changedSince),
    });
    expect(where).not.toHaveProperty('status');
    expect(where).not.toHaveProperty('archivedAt');
  });
});

describe('NotificationService.readNotificationSummary', () => {
  it('returns the unread badge count and the latest change time', async (): Promise<void> => {
    const { calls, createQueryBuilder } = createQueryBuilderStub({
      getRawOne: { latestUpdatedAt: new Date('2026-10-18T01:02:03.456Z') },
    });
    const count = jest.fn(() => Promise.resolve(4));
    const service = createService({ count, createQueryBuilder });

    const summary = await service.readNotificationSummary('member-001');

    expect(summary.unreadCount).toBe(4);
    expect(summary.latestUpdatedAt?.toISOString()).toBe(
      '2026-10-18T01:02:03.456Z',
    );
    expect(calls).toContainEqual({
      args: [
        'notification.recipientMemberId = :recipientMemberId',
        {
          recipientMemberId: 'member-001',
        },
      ],
      method: 'andWhere',
    });
  });

  it('returns a null change time for a member without notifications', async (): Promise<void> => {
    const { createQueryBuilder } = createQueryBuilderStub({
      getRawOne: { latestUpdatedAt: null },
    });
    const service = createService({
      count: () => Promise.resolve(0),
      createQueryBuilder,
    });

    await expect(
      service.readNotificationSummary('member-001'),
    ).resolves.toMatchObject({ latestUpdatedAt: null, unreadCount: 0 });
  });
});

describe('NotificationService.markNotificationsRead', () => {
  it('marks only the member unread in-app rows and returns the changed ids in input order', async (): Promise<void> => {
    const { calls, createQueryBuilder } = createQueryBuilderStub({
      execute: { raw: [{ id: CURSOR_ID }, { id: OTHER_ID }] },
    });
    const service = createService({ createQueryBuilder });

    const changedIds = await service.markNotificationsRead({
      ids: [OTHER_ID, CURSOR_ID, OTHER_ID, '', 'not-a-uuid'],
      readerMemberId: ' member-001 ',
    });

    expect(changedIds).toEqual([OTHER_ID, CURSOR_ID]);

    const whereCalls = calls.filter(
      ({ method }): boolean => method === 'where' || method === 'andWhere',
    );

    expect(whereCalls.map(({ args }) => args)).toEqual([
      ['id IN (:...ids)', { ids: [OTHER_ID, CURSOR_ID] }],
      [
        'recipient_member_id = :recipientMemberId',
        { recipientMemberId: 'member-001' },
      ],
      ['channel = :channel', { channel: NotificationChannelEnum.IN_APP }],
      ['status <> :readStatus', { readStatus: NotificationStatusEnum.READ }],
    ]);
    expect(calls).toContainEqual({ args: [['id']], method: 'returning' });

    const [patch] = calls.find(({ method }) => method === 'set')
      ?.args as readonly [Record<string, unknown>];

    expect(patch.status).toBe(NotificationStatusEnum.READ);
    expect(patch.readAt).toBeInstanceOf(Date);
  });

  it('matches uppercase ids against the lowercase ids Postgres returns', async (): Promise<void> => {
    const { calls, createQueryBuilder } = createQueryBuilderStub({
      execute: { raw: [{ id: CURSOR_ID }] },
    });
    const service = createService({ createQueryBuilder });

    await expect(
      service.markNotificationsRead({
        ids: [CURSOR_ID.toUpperCase(), CURSOR_ID],
        readerMemberId: 'member-001',
      }),
    ).resolves.toEqual([CURSOR_ID]);
    expect(calls).toContainEqual({
      args: ['id IN (:...ids)', { ids: [CURSOR_ID] }],
      method: 'where',
    });
  });

  it('leaves out ids the update did not change', async (): Promise<void> => {
    const { createQueryBuilder } = createQueryBuilderStub({
      execute: { raw: [{ id: OTHER_ID }] },
    });
    const service = createService({ createQueryBuilder });

    await expect(
      service.markNotificationsRead({
        ids: [CURSOR_ID, OTHER_ID],
        readerMemberId: 'member-001',
      }),
    ).resolves.toEqual([OTHER_ID]);
  });

  it('returns nothing without touching the database for a blank member or no usable ids', async (): Promise<void> => {
    const { createQueryBuilder } = createQueryBuilderStub({});
    const service = createService({ createQueryBuilder });

    await expect(
      service.markNotificationsRead({ ids: [CURSOR_ID], readerMemberId: ' ' }),
    ).resolves.toEqual([]);
    await expect(
      service.markNotificationsRead({
        ids: ['', 'nope'],
        readerMemberId: 'member-001',
      }),
    ).resolves.toEqual([]);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('refuses more ids than one call accepts', async (): Promise<void> => {
    const { createQueryBuilder } = createQueryBuilderStub({});
    const service = createService({ createQueryBuilder });
    const ids = Array.from(
      { length: MARK_NOTIFICATIONS_READ_LIMIT + 1 },
      (_, index): string =>
        `6f1c1f43-6a43-4f43-9d55-${index.toString(16).padStart(12, '0')}`,
    );

    await expect(
      service.markNotificationsRead({ ids, readerMemberId: 'member-001' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });
});
