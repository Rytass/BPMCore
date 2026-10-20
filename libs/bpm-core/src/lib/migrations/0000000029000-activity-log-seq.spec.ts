import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { ActivityLogSeq0000000029000 } from './0000000029000-activity-log-seq';

/** One statement with its whitespace collapsed, for an exact comparison. */
function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('ActivityLogSeq0000000029000', () => {
  it('backfills in write order before making the column an identity, then adds the unique index', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new ActivityLogSeq0000000029000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(5);
    // No IF NOT EXISTS: a column that already exists was numbered without the
    // backfill, so the migration must fail rather than skip.
    expect(statements[0]).toContain('ADD COLUMN "seq" bigint NULL');
    expect(statements[0]).not.toContain('IF NOT EXISTS');
    // One numbering over the whole table, in the order rows were written. The
    // whole statement is compared, so a dropped or reordered sort key fails.
    expect(normalizeSql(statements[1])).toBe(
      normalizeSql(`
        UPDATE "activity_logs" AS "log"
           SET "seq" = "ordered"."seq"
          FROM (
            SELECT "id",
                   row_number() OVER (
                     ORDER BY "created_at", cmin::text::bigint, ctid, "id"
                   ) AS "seq"
              FROM "activity_logs"
          ) AS "ordered"
         WHERE "ordered"."id" = "log"."id"
      `),
    );
    expect(statements[2]).toContain('ALTER COLUMN "seq" SET NOT NULL');
    // Identity and its start value in one statement; COALESCE keeps an empty
    // table from producing "START WITH )". Compared whole, so the start value
    // cannot drift from one past the backfilled maximum.
    expect(normalizeSql(statements[3])).toBe(
      normalizeSql(`
        DO $$
        DECLARE
          next_seq bigint;
        BEGIN
          SELECT COALESCE(MAX("seq"), 0) + 1 INTO next_seq FROM "activity_logs";

          EXECUTE format(
            'ALTER TABLE "activity_logs" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY (START WITH %s)',
            next_seq
          );
        END
        $$
      `),
    );
    expect(statements[4]).toContain(
      'CREATE UNIQUE INDEX "IDX_activity_logs_instance_seq"',
    );
    expect(statements[4]).toContain('("instance_id", "seq")');
  });

  it('removes the index before the column on the way down', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new ActivityLogSeq0000000029000();

    await migration.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "IDX_activity_logs_instance_seq"',
    );
    expect(statements[1]).toContain('DROP COLUMN IF EXISTS "seq"');
  });

  it('is registered last in the migration list', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (migration): string => migration.name,
    );

    expect(names[names.length - 1]).toBe('ActivityLogSeq0000000029000');
  });
});
