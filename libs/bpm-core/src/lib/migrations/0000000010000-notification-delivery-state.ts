import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationDeliveryState0000000010000 implements MigrationInterface {
  name = 'NotificationDeliveryState0000000010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamptz NULL,
      ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz NULL,
      ADD COLUMN IF NOT EXISTS "delivery_error" text NULL,
      ADD COLUMN IF NOT EXISTS "delivered_at" timestamptz NULL,
      ADD COLUMN IF NOT EXISTS "delivery_target" text NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_pending_delivery"
      ON "notifications" ("status", "next_retry_at", "created_at")
      WHERE "status" = 'PENDING'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_notifications_pending_delivery"',
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN IF EXISTS "delivery_target",
      DROP COLUMN IF EXISTS "delivered_at",
      DROP COLUMN IF EXISTS "delivery_error",
      DROP COLUMN IF EXISTS "next_retry_at",
      DROP COLUMN IF EXISTS "last_attempt_at",
      DROP COLUMN IF EXISTS "attempt_count"
    `);
  }
}
