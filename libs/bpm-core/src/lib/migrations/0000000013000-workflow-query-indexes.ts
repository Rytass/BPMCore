import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkflowQueryIndexes0000000013000 implements MigrationInterface {
  readonly name = 'WorkflowQueryIndexes0000000013000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instances_created_desc"
      ON "approval_instances" ("created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instances_state_created_desc"
      ON "approval_instances" ("state", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instances_template_created_desc"
      ON "approval_instances" ("template_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instances_initiator_created_desc"
      ON "approval_instances" ("initiator_member_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instances_title_trgm"
      ON "approval_instances"
      USING gin (lower("title") gin_trgm_ops)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instances_initiator_trgm"
      ON "approval_instances"
      USING gin (lower("initiator_member_id") gin_trgm_ops)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_instance_assignee_read"
      ON "tasks" ("instance_id", "assignee_member_id")
      WHERE "assignee_member_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_instance_original_assignee_read"
      ON "tasks" ("instance_id", "original_assignee_member_id")
      WHERE "original_assignee_member_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_candidates_member_task"
      ON "task_candidates" ("member_id", "task_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_candidates_original_member_task"
      ON "task_candidates" ("original_member_id", "task_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_decisions_decider_task"
      ON "task_decisions" ("decided_by_member_id", "task_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_recipient_instance"
      ON "notifications" ("recipient_member_id", "instance_id")
      WHERE "instance_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_notifications_recipient_instance"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_task_decisions_decider_task"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_task_candidates_original_member_task"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_task_candidates_member_task"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_tasks_instance_original_assignee_read"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_tasks_instance_assignee_read"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_approval_instances_initiator_trgm"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_approval_instances_title_trgm"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_approval_instances_initiator_created_desc"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_approval_instances_template_created_desc"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_approval_instances_state_created_desc"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_approval_instances_created_desc"',
    );
  }
}
