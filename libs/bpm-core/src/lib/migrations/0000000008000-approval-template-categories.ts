import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApprovalTemplateCategories2026051208000 implements MigrationInterface {
  readonly name = 'ApprovalTemplateCategories2026051208000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS approval_template_categories (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        description text NULL,
        is_active boolean NOT NULL DEFAULT true,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE approval_templates
      ADD COLUMN IF NOT EXISTS category_id uuid NULL
    `);

    await queryRunner.query(`
      WITH distinct_categories AS (
        SELECT
          btrim(category) AS name,
          min(created_at) AS created_at,
          min(updated_at) AS updated_at
        FROM approval_templates
        WHERE category IS NOT NULL
          AND btrim(category) <> ''
        GROUP BY btrim(category)
      )
      INSERT INTO approval_template_categories (
        name,
        created_at,
        updated_at
      )
      SELECT
        distinct_categories.name,
        distinct_categories.created_at,
        distinct_categories.updated_at
      FROM distinct_categories
    `);

    await queryRunner.query(`
      UPDATE approval_templates AS template
      SET category_id = category.id
      FROM approval_template_categories AS category
      WHERE template.category_id IS NULL
        AND template.category IS NOT NULL
        AND btrim(template.category) <> ''
        AND category.name = btrim(template.category)
    `);

    await queryRunner.query(`
      ALTER TABLE approval_templates
      ADD CONSTRAINT fk_approval_templates_category
      FOREIGN KEY (category_id)
      REFERENCES approval_template_categories(id)
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_template_categories_active_sort
      ON approval_template_categories(is_active, sort_order, name)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_templates_category_id
      ON approval_templates(category_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_approval_templates_category_id
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_approval_template_categories_active_sort
    `);
    await queryRunner.query(`
      ALTER TABLE approval_templates
      DROP CONSTRAINT IF EXISTS fk_approval_templates_category
    `);
    await queryRunner.query(`
      ALTER TABLE approval_templates
      DROP COLUMN IF EXISTS category_id
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS approval_template_categories
    `);
  }
}
