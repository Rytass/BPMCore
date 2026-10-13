import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who actually submitted an approval instance, when that is not the applicant.
 *
 * `submitted_by_member_id` is NULL for every row written before the column
 * existed, and the engine reads NULL as "the initiator submitted it". Rows are
 * deliberately not backfilled: writing the initiator into them would say the
 * same thing and cost a table rewrite on a large instance table.
 *
 * The "sent by me" list matches `initiator_member_id OR submitted_by_member_id`,
 * so the new column gets the same `(member, created_at DESC)` index the
 * initiator has (migration 13000); without it the OR falls back to a scan. Like
 * that one it is created here only and not declared on the entity.
 */
export class ApprovalInstanceSubmittedBy0000000027000 implements MigrationInterface {
  name = 'ApprovalInstanceSubmittedBy0000000027000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_instances"
      ADD COLUMN IF NOT EXISTS "submitted_by_member_id" text NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_approval_instances_submitted_by_created_desc"
      ON "approval_instances" ("submitted_by_member_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_approval_instances_submitted_by_created_desc"
    `);

    await queryRunner.query(`
      ALTER TABLE "approval_instances"
      DROP COLUMN IF EXISTS "submitted_by_member_id"
    `);
  }
}
