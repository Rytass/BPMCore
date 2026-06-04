import { DataSource } from 'typeorm';

/**
 * Legacy (date-stamped) -> current (sequential) migration class names.
 *
 * Early BPMCore migrations were named with date-based timestamps
 * (`...2026050202000`); they were later renamed to a zero-padded sequential
 * scheme (`...0000000002000`). TypeORM keys idempotency on `migrations.name`,
 * so any database whose `migrations` table still holds the old names would see
 * the renamed classes as *pending* and try to re-run their `up()` — failing on
 * already-existing objects (e.g. duplicate constraints).
 *
 * Each pair maps the exact same migration (same already-applied SQL); only the
 * class name's numeric suffix changed. Reconciling the tracking-table rows is a
 * metadata-only correction — it changes no schema.
 */
const LEGACY_MIGRATION_RENAMES: ReadonlyArray<readonly [string, string]> = [
  [
    'EnablePostgresExtensions2026043000000',
    'EnablePostgresExtensions0000000000001',
  ],
  [
    'IdentityOrganizationFoundation2026043001000',
    'IdentityOrganizationFoundation0000000001000',
  ],
  ['FormBuilderFoundation2026050202000', 'FormBuilderFoundation0000000002000'],
  [
    'ApprovalTemplateFoundation2026050403000',
    'ApprovalTemplateFoundation0000000003000',
  ],
  [
    'WorkflowEngineFoundation2026050404000',
    'WorkflowEngineFoundation0000000004000',
  ],
  [
    'ApprovalTemplateCategories2026051208000',
    'ApprovalTemplateCategories0000000008000',
  ],
  ['TaskCandidates2026051309000', 'TaskCandidates0000000009000'],
];

/**
 * Rename any legacy-named migration tracking rows to their current class names
 * so `runMigrations()` recognises them as already applied. Idempotent and safe
 * on fresh databases (no `migrations` table yet → no-op) and on
 * already-reconciled databases (target name present → skip).
 *
 * MUST be invoked *before* `DataSource.runMigrations()`, since TypeORM freezes
 * its pending-migration set at the start of that call.
 *
 * @returns the number of tracking rows renamed.
 */
export async function reconcileLegacyMigrationNames(
  dataSource: DataSource,
): Promise<number> {
  const tableProbe = (await dataSource.query(
    `SELECT to_regclass('migrations') AS migrations_table`,
  )) as readonly { readonly migrations_table: string | null }[];

  if (!tableProbe[0]?.migrations_table) {
    return 0;
  }

  return dataSource.transaction(async (manager): Promise<number> => {
    return LEGACY_MIGRATION_RENAMES.reduce<Promise<number>>(
      async (countPromise, [legacyName, currentName]): Promise<number> => {
        const count = await countPromise;
        const alreadyCurrent = (await manager.query(
          'SELECT 1 FROM migrations WHERE name = $1 LIMIT 1',
          [currentName],
        )) as readonly unknown[];

        if (alreadyCurrent.length > 0) {
          return count;
        }

        const result = (await manager.query(
          'UPDATE migrations SET name = $1 WHERE name = $2',
          [currentName, legacyName],
        )) as readonly [unknown, number];

        return count + (Number(result[1]) || 0);
      },
      Promise.resolve(0),
    );
  });
}
