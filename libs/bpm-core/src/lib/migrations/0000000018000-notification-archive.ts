import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationArchive0000000018000 implements MigrationInterface {
  name = 'NotificationArchive0000000018000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN IF NOT EXISTS "archived_at" timestamptz NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_recipient_active"
      ON "notifications" ("recipient_member_id", "created_at")
      WHERE "archived_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_notifications_recipient_active"',
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN IF EXISTS "archived_at"
    `);
  }
}
