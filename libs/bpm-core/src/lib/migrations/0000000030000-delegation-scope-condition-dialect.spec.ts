import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { DelegationScopeConditionDialect0000000030000 } from './0000000030000-delegation-scope-condition-dialect';

const runStatements = async (
  step: (queryRunner: QueryRunner) => Promise<void>,
): Promise<readonly string[]> => {
  const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

  await step({ query } as unknown as QueryRunner);

  return query.mock.calls.map(([sql]): string => sql);
};

describe('DelegationScopeConditionDialect0000000030000', (): void => {
  const migration = new DelegationScopeConditionDialect0000000030000();

  it('adds the column with cel-legacy for every existing rule, then limits its values', async (): Promise<void> => {
    const statements = await runStatements((queryRunner) =>
      migration.up(queryRunner),
    );

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('ALTER TABLE "delegation_rules"');
    expect(statements[0]).toContain(
      `ADD COLUMN IF NOT EXISTS "scope_condition_dialect" text NOT NULL DEFAULT 'cel-legacy'`,
    );
    expect(statements[1]).toContain(
      'DROP CONSTRAINT IF EXISTS "CHK_delegation_rules_scope_condition_dialect"',
    );
    expect(statements[2]).toContain(
      'ADD CONSTRAINT "CHK_delegation_rules_scope_condition_dialect"',
    );
    expect(statements[2]).toContain(
      `CHECK ("scope_condition_dialect" IN ('cel-legacy', 'cel-v2'))`,
    );
    // Nothing is upgraded on the way up.
    expect(statements.join('\n')).not.toMatch(/UPDATE/u);
  });

  it('refuses to go down while a rule uses another dialect, before dropping anything', async (): Promise<void> => {
    const statements = await runStatements((queryRunner) =>
      migration.down(queryRunner),
    );

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain(
      `WHERE "scope_condition_dialect" <> ''cel-legacy''`,
    );
    expect(statements[0]).toContain('RAISE EXCEPTION');
    expect(statements[1]).toContain(
      'DROP CONSTRAINT IF EXISTS "CHK_delegation_rules_scope_condition_dialect"',
    );
    expect(statements[2]).toContain(
      'DROP COLUMN IF EXISTS "scope_condition_dialect"',
    );
  });

  it('is registered last in the migration list', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (registered): string => registered.name,
    );

    expect(names[names.length - 1]).toBe(
      'DelegationScopeConditionDialect0000000030000',
    );
  });
});
