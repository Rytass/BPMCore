import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { NotificationUpdatedAt0000000028000 } from './0000000028000-notification-updated-at';

describe('NotificationUpdatedAt0000000028000', () => {
  it('backfills the column before making it required, then installs the trigger and index', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new NotificationUpdatedAt0000000028000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(8);
    expect(statements[0]).toContain(
      'ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NULL',
    );
    // Backfilled from the timestamps the row already records, at millisecond
    // precision, before NOT NULL is enforced.
    expect(statements[1]).toContain('GREATEST(');
    expect(statements[1]).toContain("date_trunc(\n           'milliseconds'");
    expect(statements[2]).toContain(
      "SET DEFAULT date_trunc('milliseconds', clock_timestamp())",
    );
    expect(statements[3]).toContain('SET NOT NULL');
    // Only a real change advances the value.
    expect(statements[4]).toContain(
      'IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN',
    );
    expect(statements[6]).toContain('BEFORE UPDATE ON "notifications"');
    expect(statements[7]).toContain(
      'ON "notifications" ("recipient_member_id", "updated_at")',
    );
  });

  it('removes the index, trigger and function before the column on the way down', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new NotificationUpdatedAt0000000028000();

    await migration.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "IDX_notifications_recipient_updated_at"',
    );
    expect(statements[1]).toContain('DROP TRIGGER IF EXISTS');
    expect(statements[2]).toContain('DROP FUNCTION IF EXISTS');
    expect(statements[3]).toContain('DROP COLUMN IF EXISTS "updated_at"');
  });

  it('is registered in the migration list', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (migration): string => migration.name,
    );

    expect(names).toContain('NotificationUpdatedAt0000000028000');
  });
});
