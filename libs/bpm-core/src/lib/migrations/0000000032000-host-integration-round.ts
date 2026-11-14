import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema for ADR 27 (host integration round). Every change is additive and its
 * default is the behaviour before this migration, so `down` can drop it all.
 *
 * - `approval_templates.key`: a key the host declares for a template it owns
 *   (§6). Unique among templates that are not soft-deleted, so a deleted
 *   template frees its key.
 * - `approval_templates.host_managed` / `form_definitions.host_managed`: the
 *   definition is maintained by host code and BPM's own lists leave it out by
 *   default (§9). Not a lock.
 * - `approval_template_versions.launch_mode`: `HOST_ONLY` refuses submission
 *   and resubmission through GraphQL (§5). Versioned with
 *   `initiator_policy_cel`, which it sits beside.
 * - `approval_instance_events`: outbox of instance lifecycle events (§1). A row
 *   is written inside the transaction that changes the instance and delivered
 *   to the host's observer after it commits. `seq` orders the events of one
 *   instance; it is not a cursor across instances, because identity values are
 *   assigned at insert, not at commit.
 */
export class HostIntegrationRound0000000032000 implements MigrationInterface {
  name = 'HostIntegrationRound0000000032000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_templates"
        ADD COLUMN IF NOT EXISTS "key" text NULL,
        ADD COLUMN IF NOT EXISTS "host_managed" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_approval_templates_key_live"
      ON "approval_templates" ("key")
      WHERE "key" IS NOT NULL AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "form_definitions"
        ADD COLUMN IF NOT EXISTS "host_managed" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "approval_template_versions"
        ADD COLUMN IF NOT EXISTS "launch_mode" text NOT NULL DEFAULT 'OPEN'
    `);
    await queryRunner.query(`
      ALTER TABLE "approval_template_versions"
        DROP CONSTRAINT IF EXISTS "CHK_approval_template_versions_launch_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "approval_template_versions"
        ADD CONSTRAINT "CHK_approval_template_versions_launch_mode"
        CHECK ("launch_mode" IN ('OPEN', 'HOST_ONLY'))
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "approval_instance_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "seq" bigint GENERATED ALWAYS AS IDENTITY,
        "instance_id" uuid NOT NULL,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL,
        "status" text NOT NULL DEFAULT 'PENDING',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "claimed_at" timestamptz NULL,
        "delivered_at" timestamptz NULL,
        "last_error" text NULL,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_approval_instance_events_instance"
          FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_approval_instance_events_status"
          CHECK ("status" IN ('PENDING', 'DELIVERED', 'FAILED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instance_events_due"
      ON "approval_instance_events" ("status", "next_attempt_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instance_events_instance_seq"
      ON "approval_instance_events" ("instance_id", "seq")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "approval_instance_events"`);
    await queryRunner.query(`
      ALTER TABLE "approval_template_versions"
        DROP CONSTRAINT IF EXISTS "CHK_approval_template_versions_launch_mode",
        DROP COLUMN IF EXISTS "launch_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "form_definitions" DROP COLUMN IF EXISTS "host_managed"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_approval_templates_key_live"`,
    );
    await queryRunner.query(`
      ALTER TABLE "approval_templates"
        DROP COLUMN IF EXISTS "host_managed",
        DROP COLUMN IF EXISTS "key"
    `);
  }
}
