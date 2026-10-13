import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { ApprovalInstanceSubmittedBy0000000027000 } from './0000000027000-approval-instance-submitted-by';

describe('ApprovalInstanceSubmittedBy0000000027000', () => {
  it('adds the nullable submitted-by column without backfilling it', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new ApprovalInstanceSubmittedBy0000000027000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('ALTER TABLE "approval_instances"');
    expect(statements[0]).toContain(
      'ADD COLUMN IF NOT EXISTS "submitted_by_member_id" text NULL',
    );
  });

  it('drops the column on the way down', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new ApprovalInstanceSubmittedBy0000000027000();

    await migration.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(
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
