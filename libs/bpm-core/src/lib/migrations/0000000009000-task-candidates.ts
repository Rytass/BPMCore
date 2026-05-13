import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskCandidates2026051309000 implements MigrationInterface {
  readonly name = 'TaskCandidates2026051309000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tasks
      ALTER COLUMN original_assignee_member_id DROP NOT NULL,
      ALTER COLUMN assignee_member_id DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS assignment_type text NOT NULL DEFAULT 'DIRECT_MEMBER',
      ADD COLUMN IF NOT EXISTS decision_policy_snapshot jsonb NOT NULL DEFAULT '{"type":"SINGLE"}'::jsonb
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_candidates (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        member_id text NOT NULL,
        original_member_id text NOT NULL,
        source_type text NOT NULL,
        delegation_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL,
        claimed_at timestamptz NULL,
        decided_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO task_candidates (
        task_id,
        member_id,
        original_member_id,
        source_type,
        delegation_chain,
        status,
        claimed_at,
        decided_at,
        created_at
      )
      SELECT
        id,
        assignee_member_id,
        COALESCE(original_assignee_member_id, assignee_member_id),
        'DIRECT',
        delegation_chain,
        CASE
          WHEN status = 'COMPLETED' THEN 'COMPLETED'
          WHEN status = 'TRANSFERRED' THEN 'TRANSFERRED'
          WHEN status = 'CANCELLED' THEN 'CANCELLED'
          ELSE 'PENDING'
        END,
        opened_at,
        completed_at,
        created_at
      FROM tasks
      WHERE assignee_member_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM task_candidates
          WHERE task_candidates.task_id = tasks.id
            AND task_candidates.member_id = tasks.assignee_member_id
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_candidates_task_member
      ON task_candidates(task_id, member_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_candidates_member_status
      ON task_candidates(member_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_candidates_task
      ON task_candidates(task_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS task_candidates');
    await queryRunner.query(`
      ALTER TABLE tasks
      DROP COLUMN IF EXISTS decision_policy_snapshot,
      DROP COLUMN IF EXISTS assignment_type
    `);
    await queryRunner.query(`
      ALTER TABLE tasks
      ALTER COLUMN original_assignee_member_id SET NOT NULL,
      ALTER COLUMN assignee_member_id SET NOT NULL
    `);
  }
}
