import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApprovalTemplateActivation0000000019000 implements MigrationInterface {
  readonly name = 'ApprovalTemplateActivation0000000019000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE approval_templates
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_templates_is_active
      ON approval_templates(is_active)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_approval_templates_is_active
    `);
    await queryRunner.query(`
      ALTER TABLE approval_templates
      DROP COLUMN IF EXISTS is_active
    `);
  }
}
