import { MigrationInterface, QueryRunner } from 'typeorm';

export class SignaturesAttachments0000000007000 implements MigrationInterface {
  name = 'SignaturesAttachments0000000007000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "signatures" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "instance_id" uuid NOT NULL,
        "task_id" uuid NULL,
        "signer_member_id" text NOT NULL,
        "algorithm" text NOT NULL,
        "signed_payload" jsonb NOT NULL,
        "signed_payload_hash" text NOT NULL,
        "signature" text NOT NULL,
        "key_version" integer NOT NULL,
        "previous_signature_hash" text NULL,
        "timestamp_token" bytea NULL,
        "signed_at" timestamptz NOT NULL,
        CONSTRAINT "PK_signatures_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_signatures_instance"
          FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_signatures_task"
          FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_signatures_instance_signed_at"
      ON "signatures" ("instance_id", "signed_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_signatures_signer_signed_at"
      ON "signatures" ("signer_member_id", "signed_at")
    `);
    await queryRunner.query(`
      ALTER TABLE "task_decisions"
      ADD CONSTRAINT "FK_task_decisions_signature"
      FOREIGN KEY ("signature_id") REFERENCES "signatures"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attachments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "instance_id" uuid NULL,
        "task_id" uuid NULL,
        "form_field_path" text NULL,
        "uploader_member_id" text NOT NULL,
        "filename" text NOT NULL,
        "mime_type" text NOT NULL,
        "size_bytes" bigint NOT NULL,
        "storage_provider" text NOT NULL,
        "storage_key" text NOT NULL,
        "encryption_key_id" text NULL,
        "checksum_sha256" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attachments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attachments_instance"
          FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_attachments_task"
          FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_attachments_instance"
      ON "attachments" ("instance_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_attachments_task"
      ON "attachments" ("task_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_attachments_task"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_attachments_instance"');
    await queryRunner.query('DROP TABLE IF EXISTS "attachments"');
    await queryRunner.query(`
      ALTER TABLE "task_decisions"
      DROP CONSTRAINT IF EXISTS "FK_task_decisions_signature"
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_signatures_signer_signed_at"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_signatures_instance_signed_at"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "signatures"');
  }
}
