import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { ActivityLogAdvanceFailedIndex0000000033000 } from './0000000033000-activity-log-advance-failed-index';

const runStatements = async (
  step: (queryRunner: QueryRunner) => Promise<void>,
): Promise<readonly string[]> => {
  const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

  await step({ query } as unknown as QueryRunner);

  return query.mock.calls.map(([sql]): string => sql);
};

describe('ActivityLogAdvanceFailedIndex0000000033000', (): void => {
  const migration = new ActivityLogAdvanceFailedIndex0000000033000();

  it('builds one partial index on the ADVANCE_FAILED rows, only if it is missing', async (): Promise<void> => {
    const statements = await runStatements((queryRunner) =>
      migration.up(queryRunner),
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(
      'CREATE INDEX IF NOT EXISTS "IDX_activity_logs_advance_failed"',
    );
    expect(statements[0]).toContain('ON "activity_logs" ("instance_id", "seq")');
    expect(statements[0]).toContain(`WHERE "event_type" = 'ADVANCE_FAILED'`);
  });

  it('builds the index inside the transaction, not CONCURRENTLY', async (): Promise<void> => {
    const statements = await runStatements((queryRunner) =>
      migration.up(queryRunner),
    );

    expect(statements.join('\n')).not.toMatch(/CONCURRENTLY/u);
    expect(migration).not.toHaveProperty('transaction');
  });

  it('drops only the index on the way down', async (): Promise<void> => {
    const statements = await runStatements((queryRunner) =>
      migration.down(queryRunner),
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "IDX_activity_logs_advance_failed"',
    );
  });

  it('is registered last, after the form data GIN index', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (registered): string => registered.name,
    );

    expect(names.indexOf('ActivityLogAdvanceFailedIndex0000000033000')).toBe(
      names.length - 1,
    );
    expect(names.indexOf('ApprovalInstanceFormDataGin0000000031000')).toBeLessThan(
      names.length - 1,
    );
  });
});
