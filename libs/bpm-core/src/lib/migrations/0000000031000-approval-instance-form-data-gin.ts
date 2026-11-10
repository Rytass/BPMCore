import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A GIN index on `approval_instances.form_data`, for the field filters of the
 * approval-instance list (ADR 25 §4.1). An equality or "in list" filter on a
 * top-level field compiles to a containment test (`form_data @> ...`), and this
 * index serves it.
 *
 * Built without `CONCURRENTLY` and without `transaction = false`, so it runs
 * inside the migration transaction under TypeORM's default transaction mode.
 * Declaring a non-transactional migration fails the whole batch when the
 * transaction mode is `all`. The cost: the build takes a SHARE lock on the
 * table, which blocks writes to approval instances for as long as it runs.
 *
 * A host with a large `approval_instances` table should build the index first,
 * outside any transaction, with the same name:
 *
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_approval_instances_form_data_gin"
 *     ON "approval_instances" USING gin ("form_data" jsonb_path_ops);
 *
 * `IF NOT EXISTS` then skips this step. Nothing else in the migration depends on
 * how the index was built.
 *
 * No table, column or backfill is involved. `down` drops only the index.
 */
export class ApprovalInstanceFormDataGin0000000031000 implements MigrationInterface {
  name = 'ApprovalInstanceFormDataGin0000000031000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instances_form_data_gin"
      ON "approval_instances" USING gin ("form_data" jsonb_path_ops)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_approval_instances_form_data_gin"
    `);
  }
}
