import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkflowEngineFoundation0000000004000 implements MigrationInterface {
  readonly name = 'WorkflowEngineFoundation0000000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS approval_instances (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        template_id uuid NOT NULL REFERENCES approval_templates(id),
        template_version_id uuid NOT NULL REFERENCES approval_template_versions(id),
        initiator_member_id text NOT NULL,
        initiator_metadata_snapshot jsonb NOT NULL,
        workflow_snapshot jsonb NOT NULL,
        form_definition_snapshot jsonb NOT NULL,
        form_data jsonb NOT NULL,
        state text NOT NULL,
        title text NOT NULL,
        started_at timestamptz NOT NULL,
        completed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_tokens (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        instance_id uuid NOT NULL REFERENCES approval_instances(id),
        current_node_id text NOT NULL,
        status text NOT NULL,
        parent_token_id uuid NULL REFERENCES workflow_tokens(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        consumed_at timestamptz NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        instance_id uuid NOT NULL REFERENCES approval_instances(id),
        token_id uuid NOT NULL REFERENCES workflow_tokens(id),
        node_id text NOT NULL,
        original_assignee_member_id text NOT NULL,
        assignee_member_id text NOT NULL,
        delegation_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL,
        sla_due_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        opened_at timestamptz NULL,
        completed_at timestamptz NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_decisions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        task_id uuid NOT NULL REFERENCES tasks(id),
        decided_by_member_id text NOT NULL,
        action text NOT NULL,
        comment text NULL,
        return_to_node_id text NULL,
        transfer_to_member_id text NULL,
        signature_id uuid NULL,
        decided_at timestamptz NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        instance_id uuid NOT NULL REFERENCES approval_instances(id),
        event_type text NOT NULL,
        actor_member_id text NULL,
        node_id text NULL,
        task_id uuid NULL REFERENCES tasks(id),
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_instances_initiator_state
      ON approval_instances(initiator_member_id, state)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_instances_template_state
      ON approval_instances(template_id, state)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_instances_state_started
      ON approval_instances(state, started_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_tokens_instance_status
      ON workflow_tokens(instance_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status
      ON tasks(assignee_member_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_instance_node
      ON tasks(instance_id, node_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_sla_due
      ON tasks(sla_due_at)
      WHERE sla_due_at IS NOT NULL AND status IN ('PENDING', 'IN_PROGRESS')
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_decisions_task
      ON task_decisions(task_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_decisions_decider
      ON task_decisions(decided_by_member_id, decided_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_logs_instance_created
      ON activity_logs(instance_id, created_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_created
      ON activity_logs(actor_member_id, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS activity_logs');
    await queryRunner.query('DROP TABLE IF EXISTS task_decisions');
    await queryRunner.query('DROP TABLE IF EXISTS tasks');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_tokens');
    await queryRunner.query('DROP TABLE IF EXISTS approval_instances');
  }
}
