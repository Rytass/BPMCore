import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationSlaIdempotency0000000012000
  implements MigrationInterface
{
  name = 'NotificationSlaIdempotency0000000012000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notifications_sla_once"
      ON "notifications" ("task_id", "recipient_member_id", "type", "channel")
      WHERE "task_id" IS NOT NULL
        AND "type" IN ('SLA_WARNING', 'SLA_OVERDUE')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_notifications_sla_once"',
    );
  }
}
