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
      // PostgreSQL already returns early from `CREATE EXTENSION IF NOT
      // EXISTS` when the extension is present, before it checks privileges, so
      // this probe is not what makes a least-privilege role work — it makes
      // the intent explicit and keeps the branch below reachable only in the
      // case that actually needs explaining.
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

  /**
   * Intentionally a no-op.
   *
   * Extensions are a one-time, database-wide prerequisite that a privileged
   * role may well have installed before BPM ever ran — and other schemas in
   * the same database may depend on them. Dropping `ltree` on the way down
   * would take something this migration did not necessarily create.
   */
  async down(): Promise<void> {
    return;
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
