import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Database-managed NOTIFY webhook endpoints (ADR 18 §3.13).
 *
 * Header values and the signing secret are stored only as AES-256-GCM
 * envelopes (`encrypted_*`); the URL is plain so it can be checked against
 * the allowlist and shown to administrators. `(key, version)` is unique: a
 * changed parameter contract is a new version, never an edit.
 *
 * The audit table records who changed which fields and when, never a value.
 */
export class WorkflowWebhookEndpoints0000000024000 implements MigrationInterface {
  name = 'WorkflowWebhookEndpoints0000000024000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_webhook_endpoints" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" text NOT NULL,
        "version" integer NOT NULL,
        "label" text NOT NULL,
        "description" text NULL,
        "parameters" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "url" text NOT NULL,
        "method" text NOT NULL DEFAULT 'POST',
        "encrypted_headers" text NULL,
        "encrypted_signing_secret" text NULL,
        "timeout_ms" integer NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "deprecated" boolean NOT NULL DEFAULT false,
        "secret_rotated_at" timestamptz NULL,
        "created_by_member_id" text NULL,
        "updated_by_member_id" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_workflow_webhook_endpoints_key_version"
          UNIQUE ("key", "version")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_webhook_endpoints_active"
      ON "workflow_webhook_endpoints" ("is_active")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_webhook_endpoint_audits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "endpoint_id" uuid NOT NULL,
        "action" text NOT NULL,
        "changed_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "actor_member_id" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_workflow_webhook_endpoint_audits_endpoint"
          FOREIGN KEY ("endpoint_id") REFERENCES "workflow_webhook_endpoints"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflow_webhook_endpoint_audits_endpoint"
      ON "workflow_webhook_endpoint_audits" ("endpoint_id", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workflow_webhook_endpoint_audits"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workflow_webhook_endpoints"`,
    );
  }
}
