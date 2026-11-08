import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The expression dialect of a delegation rule's `scope_condition_cel`
 * (ADR 22 §3.3, docs/24 §2.4).
 *
 * Every existing rule was written for `cel-js` 0.8.2, so the column defaults
 * to `cel-legacy` and existing rows take that value when it is added: adding a
 * column with a constant default fills the rows without rewriting the table
 * (PostgreSQL 11+), and the CHECK constraint then validates them once. Nothing
 * upgrades a rule to `cel-v2` here; that is a deliberate act by its author.
 *
 * `down` refuses while any rule is `cel-v2`. Dropping the column would make
 * those rules read as `cel-legacy`, and a condition written for the newer
 * engine (`form.email.contains("@")`, a macro) would then fail or route
 * differently with no one having decided that. Move such rules back by hand
 * (or revoke them) first, then run `down` again.
 */
export class DelegationScopeConditionDialect0000000030000 implements MigrationInterface {
  name = 'DelegationScopeConditionDialect0000000030000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delegation_rules"
      ADD COLUMN IF NOT EXISTS "scope_condition_dialect" text NOT NULL DEFAULT 'cel-legacy'
    `);

    // Dropped first so a rerun (or a column `synchronize` already added) does
    // not fail on an existing constraint.
    await queryRunner.query(`
      ALTER TABLE "delegation_rules"
      DROP CONSTRAINT IF EXISTS "CHK_delegation_rules_scope_condition_dialect"
    `);

    await queryRunner.query(`
      ALTER TABLE "delegation_rules"
      ADD CONSTRAINT "CHK_delegation_rules_scope_condition_dialect"
      CHECK ("scope_condition_dialect" IN ('cel-legacy', 'cel-v2'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        has_newer_dialect boolean := false;
      BEGIN
        -- Dynamic SQL: a static query would fail to plan once the column is gone.
        IF EXISTS (
          SELECT 1
            FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'delegation_rules'
             AND column_name = 'scope_condition_dialect'
        ) THEN
          EXECUTE 'SELECT EXISTS (SELECT 1 FROM "delegation_rules" WHERE "scope_condition_dialect" <> ''cel-legacy'')'
            INTO has_newer_dialect;
        END IF;

        IF has_newer_dialect THEN
          RAISE EXCEPTION 'delegation_rules has rules whose scope_condition_dialect is not cel-legacy; move them back to cel-legacy or revoke them before reverting DelegationScopeConditionDialect0000000030000';
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      ALTER TABLE "delegation_rules"
      DROP CONSTRAINT IF EXISTS "CHK_delegation_rules_scope_condition_dialect"
    `);

    await queryRunner.query(`
      ALTER TABLE "delegation_rules"
      DROP COLUMN IF EXISTS "scope_condition_dialect"
    `);
  }
}
