import { MigrationInterface, QueryRunner } from 'typeorm';

const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * PostgreSQL extensions every later BPM migration depends on: `uuid-ossp` for
 * `uuid_generate_v4()` defaults, `ltree` for the org unit `path` column and its
 * ancestor/descendant operators.
 */
const REQUIRED_EXTENSIONS = ['uuid-ossp', 'ltree'] as const;

export class EnablePostgresExtensions0000000000001 implements MigrationInterface {
  readonly name = 'EnablePostgresExtensions0000000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const extension of REQUIRED_EXTENSIONS) {
      // `CREATE EXTENSION` needs the CREATE privilege on the database, which
      // an application role usually does not have — and quite deliberately so
      // on platforms that hand out least-privilege accounts. Skipping the
      // statement when a DBA already installed the extension is what lets such
      // a deployment run its migrations at all.
      if (await isExtensionInstalled(queryRunner, extension)) {
        continue;
      }

      try {
        await queryRunner.query(
          `CREATE EXTENSION IF NOT EXISTS "${extension}"`,
        );
      } catch (error) {
        if (!isInsufficientPrivilegeError(error)) {
          throw error;
        }

        throw new Error(
          [
            `[@rytass/bpm-core-nestjs-module] Cannot create the required PostgreSQL extension "${extension}": the migration role has no CREATE privilege on this database.`,
            'This is a one-time prerequisite, not something the application role can fix at runtime. Ask a role with sufficient privilege (a superuser, the database owner, or rds_superuser) to run:',
            ...REQUIRED_EXTENSIONS.map(
              (name): string => `    CREATE EXTENSION IF NOT EXISTS "${name}";`,
            ),
            'against the BPM database, then run the migrations again. See the package README, "Database prerequisites".',
            `Original error: ${readErrorMessage(error)}`,
          ].join('\n'),
        );
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP EXTENSION IF EXISTS "ltree"');
  }
}

async function isExtensionInstalled(
  queryRunner: QueryRunner,
  extension: string,
): Promise<boolean> {
  const rows: readonly unknown[] = await queryRunner.query(
    'SELECT 1 FROM pg_extension WHERE extname = $1',
    [extension],
  );

  return rows.length > 0;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInsufficientPrivilegeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === INSUFFICIENT_PRIVILEGE
  );
}
