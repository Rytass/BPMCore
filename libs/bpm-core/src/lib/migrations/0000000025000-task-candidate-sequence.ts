import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Order of a candidate within a SEQUENTIAL task.
 *
 * `sequence` is the 0-based position in the order the candidates sign. It is
 * NULL for every task that is not signed one candidate at a time, and for rows
 * written before SEQUENTIAL meant that; those rows are deliberately not
 * backfilled so in-flight tasks keep the behaviour they were created under.
 */
export class TaskCandidateSequence0000000025000 implements MigrationInterface {
  name = 'TaskCandidateSequence0000000025000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_candidates"
      ADD COLUMN IF NOT EXISTS "sequence" integer NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_candidates"
      DROP COLUMN IF EXISTS "sequence"
    `);
  }
}
