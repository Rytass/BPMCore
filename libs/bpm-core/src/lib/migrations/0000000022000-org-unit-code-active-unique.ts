import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scopes the org unit code uniqueness to rows that are not soft-deleted.
 *
 * `org_units.code` was created as a plain `UNIQUE` column while
 * `deleteOrgUnit` only soft-deletes and `assertOrgUnitCodeAvailable` looks for
 * a clash among rows with `deleted_at IS NULL`. The two disagreed: the service
 * cleared a recycled code, and the insert was then rejected by the database
 * with a raw `duplicate key value violates unique constraint
 * "org_units_code_key"` — naming a row no query can return, because it is soft
 * deleted. Every deleted unit permanently consumed its code, which broke the
 * ordinary "close a department and recreate it under the same code" operation.
 *
 * The partial index makes the schema agree with the service. Nothing about
 * `assertOrgUnitCodeAvailable` changes; it was already the intended contract.
 */
export class OrgUnitCodeActiveUnique0000000022000 implements MigrationInterface {
  name = 'OrgUnitCodeActiveUnique0000000022000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The constraint is auto-named `org_units_code_key` by PostgreSQL, but it
    // is looked up by shape rather than by that name so a database created
    // through any other path still converges here.
    await queryRunner.query(`
      DO $$
      DECLARE
        target regclass := to_regclass('org_units');
        existing_constraint text;
      BEGIN
        IF target IS NULL THEN
          RETURN;
        END IF;

        SELECT con.conname INTO existing_constraint
        FROM pg_constraint con
        WHERE con.conrelid = target
          AND con.contype = 'u'
          AND con.conkey = ARRAY[(
            SELECT att.attnum
            FROM pg_attribute att
            WHERE att.attrelid = target
              AND att.attname = 'code'
              AND NOT att.attisdropped
          )]::smallint[];

        IF existing_constraint IS NOT NULL THEN
          EXECUTE format(
            'ALTER TABLE %s DROP CONSTRAINT %I', target::text, existing_constraint
          );
        END IF;
      END $$
    `);

    // Safe on an existing database: the constraint just dropped already
    // guaranteed global uniqueness, so the live rows cannot collide.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "org_units_code_active_key"
      ON "org_units" ("code")
      WHERE "deleted_at" IS NULL
    `);
  }

  /**
   * Restoring the global constraint fails if any code has been reused since
   * `up()` ran — which is precisely the operation this migration exists to
   * allow. Free the duplicate codes first if you genuinely need to go back.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "org_units_code_active_key"
    `);

    await queryRunner.query(`
      ALTER TABLE "org_units"
      ADD CONSTRAINT "org_units_code_key" UNIQUE ("code")
    `);
  }
}
