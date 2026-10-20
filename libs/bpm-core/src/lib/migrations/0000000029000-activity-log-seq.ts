import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The order activity log rows were written in.
 *
 * `created_at` defaults to `now()`, the transaction start time, so every row
 * one transaction writes carries the same value, and `id` is a random uuid.
 * Sorting by either leaves the rows of one submit or approval in an undefined
 * order — the instance history could show a step before the step that caused
 * it. `seq` is a `GENERATED ALWAYS` identity, so the database numbers every
 * insert and nothing can write its own value.
 *
 * Existing rows are backfilled in the order they were most likely written:
 * `created_at`, then `cmin` (the command id of the insert within its
 * transaction), then `ctid` for rows one multi-row INSERT wrote together, then
 * `id`. That recovers the true order only for rows that were never updated —
 * an update replaces `cmin` — and BPM never updates this table. Rows restored
 * with `pg_dump` or copied by logical replication share one `cmin`, and the
 * order falls back to `ctid`, which is usually but not always the write order;
 * so does a multi-row INSERT whose rows landed on different pages. Rows of two
 * transactions on the same instance follow transaction start, which can
 * differ from write order when one waited for the other's lock. New rows are
 * exact.
 *
 * Adding the column takes an ACCESS EXCLUSIVE lock on `activity_logs`, and in
 * a transaction that lock is held until commit: through the backfill (which
 * rewrites every row), `SET NOT NULL` (which scans the table) and the unique
 * index build. Nothing can read or write `activity_logs` for that whole time,
 * and every submit, decision and history read touches it, so plan the run as
 * downtime that grows with the table, in a maintenance window. Run it
 * inside a transaction (the default) and before serving the new version: in
 * transaction mode `none`, a row written by the old version between the
 * backfill and `SET NOT NULL` is NULL and fails that step, and a rerun then
 * stops at step 1 until `seq` is dropped.
 *
 * The column is added without `IF NOT EXISTS` on purpose: if it already exists
 * (for example from `synchronize`), it was numbered without this backfill, and
 * this migration should fail loudly rather than skip. The identity and its
 * start value are set in one `DO` statement so no insert can take a value in
 * between, whatever transaction mode the host runs migrations in; the unique
 * index makes any duplicate an error instead of a silent misorder.
 *
 * The backfill rewrites every activity log row once.
 */
export class ActivityLogSeq0000000029000 implements MigrationInterface {
  name = 'ActivityLogSeq0000000029000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "activity_logs"
      ADD COLUMN "seq" bigint NULL
    `);

    await queryRunner.query(`
      UPDATE "activity_logs" AS "log"
         SET "seq" = "ordered"."seq"
        FROM (
          SELECT "id",
                 row_number() OVER (
                   ORDER BY "created_at", cmin::text::bigint, ctid, "id"
                 ) AS "seq"
            FROM "activity_logs"
        ) AS "ordered"
       WHERE "ordered"."id" = "log"."id"
    `);

    await queryRunner.query(`
      ALTER TABLE "activity_logs"
      ALTER COLUMN "seq" SET NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        next_seq bigint;
      BEGIN
        SELECT COALESCE(MAX("seq"), 0) + 1 INTO next_seq FROM "activity_logs";

        EXECUTE format(
          'ALTER TABLE "activity_logs" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY (START WITH %s)',
          next_seq
        );
      END
      $$
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_activity_logs_instance_seq"
      ON "activity_logs" ("instance_id", "seq")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_activity_logs_instance_seq"
    `);

    await queryRunner.query(`
      ALTER TABLE "activity_logs"
      DROP COLUMN IF EXISTS "seq"
    `);
  }
}
