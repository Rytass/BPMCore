import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outbox for NOTIFY webhook deliveries (ADR 18 §3.5).
 *
 * A row is written inside the engine transaction that runs the NOTIFY node and
 * delivered only after that transaction commits, so a rollback leaves nothing
 * behind and nothing is ever sent for a step that did not happen.
 *
 * `(token_id, target_id)` is unique so the same token running the same node
 * twice cannot queue a second delivery; a RESTART resubmit produces a new
 * token and, correctly, a new delivery.
 */
export class WorkflowWebhookDeliveries0000000023000 implements MigrationInterface {
  name = 'WorkflowWebhookDeliveries0000000023000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_webhook_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "instance_id" uuid NOT NULL,
        "node_id" text NOT NULL,
        "token_id" uuid NOT NULL,
        "target_id" text NOT NULL,
        "endpoint_key" text NOT NULL,
        "endpoint_version" integer NOT NULL,
        "event" jsonb NOT NULL,
        "status" text NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_retry_at" timestamptz NULL,
        "last_attempt_at" timestamptz NULL,
        "last_response_status" integer NULL,
        "last_error_code" text NULL,
        "last_error_detail" text NULL,
        "sent_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_workflow_webhook_deliveries_instance"
          FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id")
          ON DELETE CASCADE,
        CONSTRAINT "UQ_workflow_webhook_deliveries_token_target"
          UNIQUE ("token_id", "target_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_webhook_deliveries_pending"
      ON "workflow_webhook_deliveries" ("status", "next_retry_at", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_webhook_deliveries_instance"
      ON "workflow_webhook_deliveries" ("instance_id", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workflow_webhook_deliveries"`,
    );
  }
}
