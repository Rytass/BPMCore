import { QueryRunner } from 'typeorm';
import { OrgUnitCodeActiveUnique0000000022000 } from './0000000022000-org-unit-code-active-unique';

describe('OrgUnitCodeActiveUnique0000000022000', () => {
  it('replaces the global code constraint with one scoped to live rows', async (): Promise<void> => {
    const query = jest.fn((_sql: string) => Promise.resolve());
    const migration = new OrgUnitCodeActiveUnique0000000022000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    // Looked up by shape, not by the auto-generated name, so a database
    // created through any other path converges on the same schema.
    expect(statements[0]).toContain("con.contype = 'u'");
    expect(statements[0]).toContain("att.attname = 'code'");
    expect(statements[0]).toContain('DROP CONSTRAINT %I');

    // The partial predicate is the whole point: without it the index would
    // keep burning the code of every soft-deleted unit.
    expect(statements[1]).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "org_units_code_active_key"',
    );
    expect(statements[1]).toContain('WHERE "deleted_at" IS NULL');
  });

  it('restores the global constraint on rollback', async (): Promise<void> => {
    const query = jest.fn((_sql: string) => Promise.resolve());
    const migration = new OrgUnitCodeActiveUnique0000000022000();

    await migration.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "org_units_code_active_key"',
    );
    expect(statements[1]).toContain(
      'ADD CONSTRAINT "org_units_code_key" UNIQUE ("code")',
    );
  });
});
