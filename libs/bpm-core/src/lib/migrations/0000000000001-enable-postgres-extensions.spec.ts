import { QueryRunner } from 'typeorm';
import { EnablePostgresExtensions0000000000001 } from './0000000000001-enable-postgres-extensions';

interface FakeDatabase {
  readonly queryRunner: QueryRunner;
  readonly statements: readonly string[];
}

function createFakeDatabase({
  canCreate,
  installed,
}: {
  readonly canCreate: boolean;
  readonly installed: readonly string[];
}): FakeDatabase {
  const statements: string[] = [];
  const query = jest.fn(
    (sql: string, parameters?: readonly unknown[]): Promise<unknown> => {
      statements.push(sql);

      if (sql.startsWith('SELECT 1 FROM pg_extension')) {
        return Promise.resolve(
          installed.includes(String(parameters?.[0])) ? [{}] : [],
        );
      }

      if (!canCreate) {
        return Promise.reject(
          Object.assign(new Error('permission denied to create extension'), {
            code: '42501',
          }),
        );
      }

      return Promise.resolve([]);
    },
  );

  return { queryRunner: { query } as unknown as QueryRunner, statements };
}

describe('EnablePostgresExtensions0000000000001', () => {
  it('creates every missing extension, pg_trgm included', async (): Promise<void> => {
    const database = createFakeDatabase({ canCreate: true, installed: [] });

    await new EnablePostgresExtensions0000000000001().up(database.queryRunner);

    expect(
      database.statements.filter((sql) => sql.startsWith('CREATE EXTENSION')),
    ).toEqual([
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
      'CREATE EXTENSION IF NOT EXISTS "ltree"',
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm"',
    ]);
  });

  it('creates nothing when a privileged role already installed them', async (): Promise<void> => {
    const database = createFakeDatabase({
      canCreate: false,
      installed: ['uuid-ossp', 'ltree', 'pg_trgm'],
    });

    await expect(
      new EnablePostgresExtensions0000000000001().up(database.queryRunner),
    ).resolves.toBeUndefined();
    expect(
      database.statements.some((sql) => sql.startsWith('CREATE EXTENSION')),
    ).toBe(false);
  });

  it('names pg_trgm in the instructions when only it is missing', async (): Promise<void> => {
    // pg_trgm used to be created only by WorkflowQueryIndexes0000000013000,
    // so a role without CREATE failed there with a bare 42501.
    const database = createFakeDatabase({
      canCreate: false,
      installed: ['uuid-ossp', 'ltree'],
    });

    const run = new EnablePostgresExtensions0000000000001().up(
      database.queryRunner,
    );

    await expect(run).rejects.toThrow(
      'Cannot create the required PostgreSQL extension "pg_trgm"',
    );
    await expect(run).rejects.toThrow(
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm";',
    );
  });
});
