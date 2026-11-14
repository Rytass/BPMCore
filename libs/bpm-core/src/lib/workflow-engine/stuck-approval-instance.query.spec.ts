import 'reflect-metadata';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskEntity } from './task.entity';
import { TaskStatusEnum } from './workflow-engine.enums';
import {
  countStuckInstances,
  readStuckFailurePage,
} from './stuck-approval-instance.query';

/*
 * Only the SQL text is checked here: no database is reached. That the SQL
 * selects what `readUnresolvedInstanceFailures` selects was checked on
 * Postgres; this keeps the shape from regressing in CI, above all a property
 * path TypeORM left unquoted (it quotes one only before a space, a comma or a
 * closing bracket), which Postgres would fold to lower case and not find.
 */
describe('stuck approval instance queries', (): void => {
  const OPEN = [TaskStatusEnum.PENDING, TaskStatusEnum.IN_PROGRESS];
  let dataSource: DataSource;

  beforeAll(async (): Promise<void> => {
    dataSource = new DataSource({
      entities: [ActivityLogEntity, ApprovalInstanceEntity, TaskEntity],
      type: 'postgres',
    });
    // Metadata only; `initialize` would connect.
    await (
      dataSource as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();
  });

  /** A manager whose queries record their SQL instead of running it. */
  const createRecordingManager = (
    recorded: string[],
  ): EntityManager =>
    ({
      createQueryBuilder: (
        ...args: Parameters<EntityManager['createQueryBuilder']>
      ): SelectQueryBuilder<ActivityLogEntity> => {
        const query = (
          dataSource.manager.createQueryBuilder as (
            ...inner: unknown[]
          ) => SelectQueryBuilder<ActivityLogEntity>
        )(...args);

        return Object.assign(query, {
          getRawMany: (): Promise<unknown[]> => {
            recorded.push(query.getQuery());

            return Promise.resolve([]);
          },
          getRawOne: (): Promise<{ count: string }> => {
            recorded.push(query.getQuery());

            return Promise.resolve({ count: '3' });
          },
        });
      },
    }) as unknown as EntityManager;

  const BARE_ALIAS =
    /(^|[^"\w])(failure|stuckInstance|failedTask|resubmitted|latest)\.\w/;

  it('pages the latest unresolved failure of each instance, newest first', async (): Promise<void> => {
    const recorded: string[] = [];

    await readStuckFailurePage(createRecordingManager(recorded), OPEN, {
      limit: 20,
      offset: 40,
    });

    const [sql = ''] = recorded;

    expect(sql).toContain('DISTINCT ON ("failure"."instance_id")');
    expect(sql).toContain(
      'ORDER BY "failure"."instance_id" ASC, "failure"."seq" DESC',
    );
    expect(sql).toContain(
      'ORDER BY "latest"."createdAt" DESC, "latest"."seq" DESC, "latest"."instanceId" ASC',
    );
    expect(sql).toContain('LIMIT 20 OFFSET 40');
    expect(sql).toContain(`TRIM("failure"."payload"->>'kind') = 'DECISION'`);
    expect(sql).toContain('"stuckInstance"."state" = ');
    expect(sql).toContain('"resubmitted"."seq" > "failure"."seq"');
    expect(sql).not.toMatch(BARE_ALIAS);
  });

  it('counts each stuck instance once with the same conditions', async (): Promise<void> => {
    const recorded: string[] = [];

    await expect(
      countStuckInstances(createRecordingManager(recorded), OPEN),
    ).resolves.toBe(3);

    const [sql = ''] = recorded;

    expect(sql).toContain('COUNT(DISTINCT "failure"."instance_id")');
    expect(sql).toContain('"failedTask"."id" = "failure"."task_id"');
    expect(sql).not.toMatch(BARE_ALIAS);
  });
});
