import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill the action-lifecycle of notifications created before the write-side
 * resolution wiring existed. Any TASK_ASSIGNED / TASK_TRANSFERRED notification
 * whose task has already left an actionable state (COMPLETED / CANCELLED /
 * TRANSFERRED) but still has a null `resolution` is marked `SUPERSEDED` (and
 * read), so a decided case can no longer show stale 同意 / 拒絕 actions.
 *
 * Idempotent: the `resolution IS NULL` guard means re-running it is a no-op.
 */
export class BackfillStaleNotificationResolution0000000015000
  implements MigrationInterface
{
  name = 'BackfillStaleNotificationResolution0000000015000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "notifications" AS n
      SET "resolution" = 'SUPERSEDED',
          "resolved_at" = now(),
          "status" = 'READ',
          "read_at" = COALESCE(n."read_at", now())
      FROM "tasks" AS t
      WHERE n."task_id" = t."id"
        AND n."type" IN ('TASK_ASSIGNED', 'TASK_TRANSFERRED')
        AND n."resolution" IS NULL
        AND t."status" IN ('COMPLETED', 'CANCELLED', 'TRANSFERRED')
    `);
  }

  async down(): Promise<void> {
    // Data backfill — no safe automatic revert (cannot distinguish rows that
    // were backfilled from rows later superseded through normal operation).
  }
}
