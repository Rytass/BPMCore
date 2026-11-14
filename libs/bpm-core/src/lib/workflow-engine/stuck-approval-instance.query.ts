import { Brackets, EntityManager, SelectQueryBuilder } from 'typeorm';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskEntity } from './task.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceStateEnum,
  TaskStatusEnum,
} from './workflow-engine.enums';

/*
 * Which `ADVANCE_FAILED` rows still describe a stuck instance, written twice:
 * `readUnresolvedInstanceFailures` in TypeScript, for the duplicate check that
 * runs when a failure is recorded, and `createUnresolvedFailureQuery` in SQL,
 * for the administrator's stuck list, so that list can be paged and counted by
 * the database. The two must say the same thing; change them together.
 *
 * - `DECISION`: the instance is RUNNING and the failed task is still open.
 *   Once the task is done, cancelled, transferred or the instance has ended,
 *   the case has moved on or been taken over.
 * - `RESUBMIT`: the instance is RETURNED and no later `INSTANCE_RESUBMITTED`
 *   exists.
 * - Any other `kind`: never unresolved.
 *
 * Not exported from the package: both are internals of the workflow engine.
 */

/** The `kind` of an `ADVANCE_FAILED` payload, trimmed; `null` when absent. */
function readFailureKind(failure: ActivityLogEntity): string | null {
  const value = failure.payload['kind'];

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The rule above for one instance, given its `ADVANCE_FAILED` and
 * `INSTANCE_RESUBMITTED` rows in `seq` order and the ids of the tasks among
 * them that are still open.
 */
export function readUnresolvedInstanceFailures(
  instance: ApprovalInstanceEntity,
  logs: readonly ActivityLogEntity[],
  openTaskIds: ReadonlySet<string>,
): readonly ActivityLogEntity[] {
  return logs.filter((failure, index): boolean => {
    if (failure.eventType !== ActivityLogEventTypeEnum.ADVANCE_FAILED) {
      return false;
    }

    const kind = readFailureKind(failure);

    if (kind === 'DECISION') {
      return (
        instance.state === ApprovalInstanceStateEnum.RUNNING &&
        failure.taskId !== null &&
        openTaskIds.has(failure.taskId)
      );
    }

    if (kind === 'RESUBMIT') {
      return (
        instance.state === ApprovalInstanceStateEnum.RETURNED &&
        !logs
          .slice(index + 1)
          .some(
            (log): boolean =>
              log.eventType === ActivityLogEventTypeEnum.INSTANCE_RESUBMITTED,
          )
      );
    }

    return false;
  });
}

/*
 * TypeORM rewrites `alias.property` to the quoted column only when the next
 * character is a space, a comma or a closing bracket; before a line break it
 * leaves the path bare, which Postgres folds to lower case and cannot find. So
 * every condition below is a single line.
 */
const FAILURE_KIND_SQL = `TRIM("failure"."payload"->>'kind')`;

/**
 * The rule above as SQL: every unresolved `ADVANCE_FAILED` row (alias
 * `failure`), joined to its instance (alias `stuckInstance`).
 */
function createUnresolvedFailureQuery(
  manager: EntityManager,
  openTaskStatuses: readonly TaskStatusEnum[],
): SelectQueryBuilder<ActivityLogEntity> {
  const query = manager
    .createQueryBuilder(ActivityLogEntity, 'failure')
    .innerJoin(
      ApprovalInstanceEntity,
      'stuckInstance',
      'stuckInstance.id = failure.instanceId',
    );
  const openTask = query
    .subQuery()
    .select('1')
    .from(TaskEntity, 'failedTask')
    .where('failedTask.id = failure.taskId ')
    .andWhere('failedTask.status IN (:...stuckOpenTaskStatuses) ')
    .getQuery();
  const laterResubmission = query
    .subQuery()
    .select('1')
    .from(ActivityLogEntity, 'resubmitted')
    .where('resubmitted.instanceId = failure.instanceId ')
    .andWhere('resubmitted.eventType = :stuckResubmittedEventType ')
    .andWhere('resubmitted.seq > failure.seq ')
    .getQuery();

  return query
    .where('failure.eventType = :stuckFailedEventType ')
    .andWhere(
      new Brackets((either): void => {
        either
          .where(
            `${FAILURE_KIND_SQL} = 'DECISION' AND stuckInstance.state = :stuckRunningState AND EXISTS ${openTask}`,
          )
          .orWhere(
            `${FAILURE_KIND_SQL} = 'RESUBMIT' AND stuckInstance.state = :stuckReturnedState AND NOT EXISTS ${laterResubmission}`,
          );
      }),
    )
    .setParameters({
      stuckFailedEventType: ActivityLogEventTypeEnum.ADVANCE_FAILED,
      stuckOpenTaskStatuses: [...openTaskStatuses],
      stuckResubmittedEventType: ActivityLogEventTypeEnum.INSTANCE_RESUBMITTED,
      stuckReturnedState: ApprovalInstanceStateEnum.RETURNED,
      stuckRunningState: ApprovalInstanceStateEnum.RUNNING,
    });
}

/**
 * One page of stuck instances, as the ids of the failure that describes each:
 * its latest unresolved `ADVANCE_FAILED` (highest `seq`). Newest failure first:
 * `created_at` is the transaction start, so `seq` breaks a tie within one
 * transaction, and the instance id any tie left after that.
 */
export async function readStuckFailurePage(
  manager: EntityManager,
  openTaskStatuses: readonly TaskStatusEnum[],
  page: { readonly offset: number; readonly limit: number },
): Promise<readonly string[]> {
  const latest = createUnresolvedFailureQuery(manager, openTaskStatuses)
    .select('failure.id', 'failureId')
    .addSelect('failure.instanceId', 'instanceId')
    .addSelect('failure.createdAt', 'createdAt')
    .addSelect('failure.seq', 'seq')
    .distinctOn(['failure.instanceId'])
    .orderBy('failure.instanceId', 'ASC')
    .addOrderBy('failure.seq', 'DESC');
  const rows = await manager
    .createQueryBuilder()
    .select('"latest"."failureId"', 'failureId')
    .from(`(${latest.getQuery()})`, 'latest')
    .setParameters(latest.getParameters())
    .orderBy('"latest"."createdAt"', 'DESC')
    .addOrderBy('"latest"."seq"', 'DESC')
    .addOrderBy('"latest"."instanceId"', 'ASC')
    .offset(page.offset)
    .limit(page.limit)
    .getRawMany<{ readonly failureId: string }>();

  return rows.map((row): string => row.failureId);
}

/** How many instances {@link readStuckFailurePage} pages through. */
export async function countStuckInstances(
  manager: EntityManager,
  openTaskStatuses: readonly TaskStatusEnum[],
): Promise<number> {
  const row = await createUnresolvedFailureQuery(manager, openTaskStatuses)
    .select('COUNT(DISTINCT failure.instanceId)', 'count')
    .getRawOne<{ readonly count: string | number }>();

  return Number(row?.count ?? 0);
}
