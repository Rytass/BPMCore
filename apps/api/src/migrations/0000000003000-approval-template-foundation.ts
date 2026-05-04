import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApprovalTemplateFoundation2026050403000
  implements MigrationInterface
{
  readonly name = 'ApprovalTemplateFoundation2026050403000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS approval_templates (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        description text NULL,
        category text NULL,
        current_version_id uuid NULL,
        deleted_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by_member_id text NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS approval_template_versions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        template_id uuid NOT NULL REFERENCES approval_templates(id),
        version int NOT NULL,
        status text NOT NULL,
        workflow_definition jsonb NOT NULL,
        form_definition_version_id uuid NULL REFERENCES form_definition_versions(id),
        initiator_policy_cel text NULL,
        notification_config jsonb NULL,
        sla_defaults jsonb NULL,
        published_at timestamptz NULL,
        published_by_member_id text NULL,
        archived_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_approval_template_versions_version UNIQUE (
          template_id,
          version
        )
      )
    `);

    await queryRunner.query(`
      ALTER TABLE approval_templates
      ADD CONSTRAINT fk_approval_templates_current_version
      FOREIGN KEY (current_version_id)
      REFERENCES approval_template_versions(id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_template_versions_template_status
      ON approval_template_versions(template_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_templates_not_deleted
      ON approval_templates(deleted_at)
      WHERE deleted_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE approval_templates
      DROP CONSTRAINT IF EXISTS fk_approval_templates_current_version
    `);
    await queryRunner.query('DROP TABLE IF EXISTS approval_template_versions');
    await queryRunner.query('DROP TABLE IF EXISTS approval_templates');
  }
}
