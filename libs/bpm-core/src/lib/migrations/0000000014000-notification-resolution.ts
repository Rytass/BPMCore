import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationResolution0000000014000 implements MigrationInterface {
  name = 'NotificationResolution0000000014000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN IF NOT EXISTS "resolution" text NULL,
      ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_open_task"
      ON "notifications" ("task_id", "recipient_member_id")
      WHERE "resolution" IS NULL AND "task_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_notifications_open_task"',
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN IF EXISTS "resolved_at",
      DROP COLUMN IF EXISTS "resolution"
    `);
  }
}
