import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Form definitions no longer keep a DRAFT version in parallel with a
 * published one: after the first publish every save publishes a brand-new
 * version directly (see FormService.publishFormDefinitionContent). Archive
 * the drafts that were forked from already-published definitions under the
 * old model so the data matches the new single-track lifecycle.
 *
 * Idempotent: the `status = 'DRAFT'` guard means re-running it is a no-op.
 */
export class ArchiveParallelFormDrafts0000000016000
  implements MigrationInterface
{
  name = 'ArchiveParallelFormDrafts0000000016000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "form_definition_versions" AS v
      SET "status" = 'ARCHIVED',
          "archived_at" = COALESCE(v."archived_at", now())
      FROM "form_definitions" AS d
      WHERE v."form_definition_id" = d."id"
        AND v."status" = 'DRAFT'
        AND d."current_version_id" IS NOT NULL
    `);
  }

  async down(): Promise<void> {
    // Data cleanup — no safe automatic revert (cannot distinguish rows
    // archived here from versions archived through normal publishing).
  }
}
