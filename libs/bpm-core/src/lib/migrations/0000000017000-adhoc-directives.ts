import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdhocDirectives0000000017000 implements MigrationInterface {
  name = 'AdhocDirectives0000000017000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_adhoc_directives" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "instance_id" uuid NOT NULL,
        "origin_task_id" uuid NOT NULL,
        "origin_node_id" text NOT NULL,
        "created_by_member_id" text NOT NULL,
        "type" text NOT NULL,
        "target_kind" text NOT NULL,
        "target_value" jsonb NOT NULL,
        "on_reject" text NULL,
        "channels" jsonb NULL,
        "comment" text NULL,
        "status" text NOT NULL DEFAULT 'PENDING',
        "consumed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_adhoc_directives_pending"
      ON "task_adhoc_directives" ("instance_id", "type")
      WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "is_adhoc" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "adhoc_type" text NULL,
      ADD COLUMN IF NOT EXISTS "adhoc_origin_task_id" uuid NULL,
      ADD COLUMN IF NOT EXISTS "adhoc_directive_id" uuid NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      DROP COLUMN IF EXISTS "adhoc_directive_id",
      DROP COLUMN IF EXISTS "adhoc_origin_task_id",
      DROP COLUMN IF EXISTS "adhoc_type",
      DROP COLUMN IF EXISTS "is_adhoc"
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_adhoc_directives_pending"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "task_adhoc_directives"');
  }
}
