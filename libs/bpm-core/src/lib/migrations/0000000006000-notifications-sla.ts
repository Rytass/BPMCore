import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationsSla0000000006000 implements MigrationInterface {
  name = 'NotificationsSla0000000006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recipient_member_id" text NOT NULL,
        "channel" text NOT NULL,
        "type" text NOT NULL,
        "instance_id" uuid NULL,
        "task_id" uuid NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" text NOT NULL,
        "sent_at" timestamptz NULL,
        "read_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_instance"
          FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_notifications_task"
          FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_recipient_status_created"
      ON "notifications" ("recipient_member_id", "status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_pending"
      ON "notifications" ("status")
      WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_task_type_channel"
      ON "notifications" ("task_id", "type", "channel")
      WHERE "task_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "member_id" text NOT NULL,
        "in_app_enabled" boolean NOT NULL DEFAULT true,
        "email_enabled" boolean NOT NULL DEFAULT true,
        "email_digest_mode" text NOT NULL DEFAULT 'INSTANT',
        "quiet_hours_start" time NULL,
        "quiet_hours_end" time NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_preferences_member_id"
          PRIMARY KEY ("member_id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "notification_preferences"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_notifications_task_type_channel"',
    );
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_notifications_pending"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_notifications_recipient_status_created"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "notifications"');
  }
}
