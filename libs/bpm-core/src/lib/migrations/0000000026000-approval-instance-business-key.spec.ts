import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { ApprovalInstanceBusinessKey0000000026000 } from './0000000026000-approval-instance-business-key';

describe('ApprovalInstanceBusinessKey0000000026000', () => {
  it('adds the nullable column and a partial unique index per template', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new ApprovalInstanceBusinessKey0000000026000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('ALTER TABLE "approval_instances"');
    expect(statements[0]).toContain(
      'ADD COLUMN IF NOT EXISTS "business_key" text NULL',
    );
    expect(statements[1]).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(statements[1]).toContain('"approval_instances_business_key_key"');
    expect(statements[1]).toContain('("template_id", "business_key")');
    // Unlabelled instances must stay free to repeat, and the state must not
    // matter: a cancelled instance keeps its key.
    expect(statements[1]).toContain('WHERE "business_key" IS NOT NULL');
    expect(statements[1]).not.toContain('"state"');
  });

  it('drops the index before the column', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new ApprovalInstanceBusinessKey0000000026000();

    await migration.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "approval_instances_business_key_key"',
    );
    expect(statements[1]).toContain('DROP COLUMN IF EXISTS "business_key"');
  });

  it('is registered in the migration list', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (migration): string => migration.name,
    );

    expect(names).toContain('ApprovalInstanceBusinessKey0000000026000');
  });
});
