import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records whether a notification was deliberately not announced.
 *
 * Before this, a member preference of `in_app_enabled = false` stopped the row
 * being written at all, so silencing notifications for an afternoon destroyed
 * every notification raised in it. In-app rows are now always recorded and
 * this column carries the announce decision instead. Existing rows were, by
 * definition, announced.
 */
export class NotificationSilenced0000000021000 implements MigrationInterface {
  name = 'NotificationSilenced0000000021000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD COLUMN IF NOT EXISTS "silenced" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP COLUMN IF EXISTS "silenced"
    `);
  }
}
