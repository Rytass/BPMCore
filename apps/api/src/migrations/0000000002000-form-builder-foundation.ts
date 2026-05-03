import { MigrationInterface, QueryRunner } from 'typeorm';

export class FormBuilderFoundation2026050202000 implements MigrationInterface {
  readonly name = 'FormBuilderFoundation2026050202000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS form_definitions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        description text NULL,
        current_version_id uuid NULL,
        deleted_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by_member_id text NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS form_definition_versions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        form_definition_id uuid NOT NULL REFERENCES form_definitions(id),
        version int NOT NULL,
        status text NOT NULL,
        schema jsonb NOT NULL,
        ui_schema jsonb NOT NULL,
        published_at timestamptz NULL,
        published_by_member_id text NULL,
        archived_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_form_definition_versions_version UNIQUE (
          form_definition_id,
          version
        )
      )
    `);

    await queryRunner.query(`
      ALTER TABLE form_definitions
      ADD CONSTRAINT fk_form_definitions_current_version
      FOREIGN KEY (current_version_id)
      REFERENCES form_definition_versions(id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_form_definition_versions_definition_status
      ON form_definition_versions(form_definition_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_form_definitions_not_deleted
      ON form_definitions(deleted_at)
      WHERE deleted_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_definitions
      DROP CONSTRAINT IF EXISTS fk_form_definitions_current_version
    `);
    await queryRunner.query('DROP TABLE IF EXISTS form_definition_versions');
    await queryRunner.query('DROP TABLE IF EXISTS form_definitions');
  }
}
