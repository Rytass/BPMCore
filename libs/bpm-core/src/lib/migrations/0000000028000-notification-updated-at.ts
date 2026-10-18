import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When a notification row last changed, so a host can ask "what changed since
 * I last looked" instead of rescanning a member's whole list.
 *
 * The column is stamped by a trigger rather than by TypeORM's
 * `@UpdateDateColumn`: the delivery claim is a raw `UPDATE`, and reads,
 * archives and task resolutions all go through different code paths. A
 * trigger covers every one of them, and only advances the value when a column
 * actually changed, so a no-op `UPDATE` does not look like a change.
 *
 * Values are truncated to milliseconds. GraphQL and JavaScript `Date` carry
 * milliseconds, so a host's watermark is millisecond-precise; a microsecond
 * value would always compare greater than the watermark taken from it and the
 * same row would come back on every poll.
 *
 * Existing rows are backfilled with the latest timestamp they already record.
 */
export class NotificationUpdatedAt0000000028000 implements MigrationInterface {
  name = 'NotificationUpdatedAt0000000028000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NULL
    `);

    await queryRunner.query(`
      UPDATE "notifications"
         SET "updated_at" = date_trunc(
           'milliseconds',
           GREATEST(
             "created_at",
             "read_at",
             "resolved_at",
             "archived_at",
             "sent_at",
             "delivered_at",
             "last_attempt_at"
           )
         )
       WHERE "updated_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "notifications"
      ALTER COLUMN "updated_at"
      SET DEFAULT date_trunc('milliseconds', clock_timestamp())
    `);

    await queryRunner.query(`
      ALTER TABLE "notifications"
      ALTER COLUMN "updated_at" SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "bpm_notifications_touch_updated_at"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
          NEW."updated_at" := date_trunc('milliseconds', clock_timestamp());
        END IF;

        RETURN NEW;
      END;
      $$
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_notifications_updated_at" ON "notifications"
    `);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_notifications_updated_at"
      BEFORE UPDATE ON "notifications"
      FOR EACH ROW
      EXECUTE FUNCTION "bpm_notifications_touch_updated_at"()
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_recipient_updated_at"
      ON "notifications" ("recipient_member_id", "updated_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_notifications_recipient_updated_at"
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_notifications_updated_at" ON "notifications"
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS "bpm_notifications_touch_updated_at"()
    `);

    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN IF EXISTS "updated_at"
    `);
  }
}
