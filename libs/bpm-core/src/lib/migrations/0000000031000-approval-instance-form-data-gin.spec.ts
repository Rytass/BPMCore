import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { ApprovalInstanceFormDataGin0000000031000 } from './0000000031000-approval-instance-form-data-gin';

const runStatements = async (
  step: (queryRunner: QueryRunner) => Promise<void>,
): Promise<readonly string[]> => {
  const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

  await step({ query } as unknown as QueryRunner);

  return query.mock.calls.map(([sql]): string => sql);
};

describe('ApprovalInstanceFormDataGin0000000031000', (): void => {
  const migration = new ApprovalInstanceFormDataGin0000000031000();

  it('builds one GIN index on form_data with jsonb_path_ops, only if it is missing', async (): Promise<void> => {
    const statements = await runStatements((queryRunner) =>
      migration.up(queryRunner),
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(
      'CREATE INDEX IF NOT EXISTS "IDX_approval_instances_form_data_gin"',
    );
    expect(statements[0]).toContain(
      'ON "approval_instances" USING gin ("form_data" jsonb_path_ops)',
    );
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
      'DROP INDEX IF EXISTS "IDX_approval_instances_form_data_gin"',
    );
  });

  it('is registered right after the delegation scope dialect migration', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (registered): string => registered.name,
    );
    const index = names.indexOf('ApprovalInstanceFormDataGin0000000031000');

    expect(names[index - 1]).toBe(
      'DelegationScopeConditionDialect0000000030000',
    );
  });
});
