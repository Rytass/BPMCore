import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { ApprovalInstanceSubmittedBy0000000027000 } from './0000000027000-approval-instance-submitted-by';

describe('ApprovalInstanceSubmittedBy0000000027000', () => {
  it('adds the nullable submitted-by column and its list index without backfilling', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new ApprovalInstanceSubmittedBy0000000027000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('ALTER TABLE "approval_instances"');
    expect(statements[0]).toContain(
      'ADD COLUMN IF NOT EXISTS "submitted_by_member_id" text NULL',
    );
    // After the column, and shaped like the initiator's index.
    expect(statements[1]).toContain(
      'CREATE INDEX IF NOT EXISTS "IDX_approval_instances_submitted_by_created_desc"',
    );
    expect(statements[1]).toContain(
      'ON "approval_instances" ("submitted_by_member_id", "created_at" DESC)',
    );
  });

  it('drops the index before the column on the way down', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new ApprovalInstanceSubmittedBy0000000027000();

    await migration.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "IDX_approval_instances_submitted_by_created_desc"',
    );
    expect(statements[1]).toContain(
      'DROP COLUMN IF EXISTS "submitted_by_member_id"',
    );
  });

  it('is registered in the migration list', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (migration): string => migration.name,
    );

    expect(names).toContain('ApprovalInstanceSubmittedBy0000000027000');
  });
});
