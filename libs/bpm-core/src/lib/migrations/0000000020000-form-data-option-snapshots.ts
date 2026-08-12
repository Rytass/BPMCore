import { MigrationInterface, QueryRunner } from 'typeorm';

export class FormDataOptionSnapshots0000000020000
  implements MigrationInterface
{
  name = 'FormDataOptionSnapshots0000000020000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_instances"
      ADD COLUMN IF NOT EXISTS "form_data_option_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_instances"
      DROP COLUMN IF EXISTS "form_data_option_snapshot"
    `);
  }
}
