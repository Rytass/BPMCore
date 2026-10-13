import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who actually submitted an approval instance, when that is not the applicant.
 *
 * `submitted_by_member_id` is NULL for every row written before the column
 * existed, and the engine reads NULL as "the initiator submitted it". Rows are
 * deliberately not backfilled: writing the initiator into them would say the
 * same thing and cost a table rewrite on a large instance table.
 */
export class ApprovalInstanceSubmittedBy0000000027000 implements MigrationInterface {
  name = 'ApprovalInstanceSubmittedBy0000000027000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_instances"
      ADD COLUMN IF NOT EXISTS "submitted_by_member_id" text NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_instances"
      DROP COLUMN IF EXISTS "submitted_by_member_id"
    `);
  }
}
