import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A partial index on the `ADVANCE_FAILED` rows of `activity_logs`, for the
 * administrator's stuck list (`stuckApprovalInstances` /
 * `stuckApprovalInstanceCount`). That query starts from the RUNNING and
 * RETURNED instances and looks up their failures; without this index each
 * lookup reads every activity row of the instance and drops the ones that are
 * not failures, so the cost grows with the history of the cases in flight.
 * With it, only failure rows are read. `seq` is the second column because the
 * query keeps each instance's highest one.
 *
 * Built without `CONCURRENTLY` and without `transaction = false`, so it runs
 * inside the migration transaction under TypeORM's default transaction mode
 * (declaring a non-transactional migration fails the whole batch when the mode
 * is `all`). The cost: the build takes a SHARE lock on `activity_logs`, which
 * blocks every submit, decision and history write for as long as it runs. It
 * reads the whole table but writes only the failure rows, which are few.
 *
 * A host with a large `activity_logs` table should build the index first,
 * outside any transaction, with the same name:
 *
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_activity_logs_advance_failed"
 *     ON "activity_logs" ("instance_id", "seq")
 *     WHERE "event_type" = 'ADVANCE_FAILED';
 *
 * `IF NOT EXISTS` then skips this step. Nothing else depends on how the index
 * was built.
 *
 * No table, column or backfill is involved. `down` drops only the index.
 */
export class ActivityLogAdvanceFailedIndex0000000033000 implements MigrationInterface {
  name = 'ActivityLogAdvanceFailedIndex0000000033000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_logs_advance_failed"
      ON "activity_logs" ("instance_id", "seq")
      WHERE "event_type" = 'ADVANCE_FAILED'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_activity_logs_advance_failed"
    `);
  }
}
