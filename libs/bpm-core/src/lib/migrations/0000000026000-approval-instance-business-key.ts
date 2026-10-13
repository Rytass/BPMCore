import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a host map one of its own documents to the approval instance it was
 * submitted as.
 *
 * `business_key` is NULL for every existing row and for every instance the
 * host did not label (GraphQL submits never carry one); nothing is backfilled.
 * The partial unique index makes a key unique within a template and, being
 * partial, leaves unlabelled rows free to repeat. It deliberately ignores
 * `state`: a CANCELLED or REJECTED instance still holds its key, so the host
 * decides what a re-submission of the same document means instead of the
 * engine silently freeing the key.
 *
 * Rolling back drops the index before the column.
 */
export class ApprovalInstanceBusinessKey0000000026000 implements MigrationInterface {
  name = 'ApprovalInstanceBusinessKey0000000026000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_instances"
      ADD COLUMN IF NOT EXISTS "business_key" text NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "approval_instances_business_key_key"
      ON "approval_instances" ("template_id", "business_key")
      WHERE "business_key" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "approval_instances_business_key_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "approval_instances"
      DROP COLUMN IF EXISTS "business_key"
    `);
  }
}
