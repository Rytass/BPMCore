import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Order of a candidate within a SEQUENTIAL task.
 *
 * `sequence` is the 0-based position in the order the candidates sign. It is
 * NULL for every task that is not signed one candidate at a time, and for rows
 * written before SEQUENTIAL meant that; those rows are deliberately not
 * backfilled so in-flight tasks keep the behaviour they were created under.
 *
 * `tasks.sla_started_at` is when the current SLA window began; a SEQUENTIAL
 * task restarts it for every candidate, and NULL means "since creation".
 *
 * Rolling back turns WAITING candidates into PENDING first: without the
 * `sequence` column nothing could ever activate them, and the task would be
 * stranded. The task then behaves like the old all-at-once SEQUENTIAL.
 */
export class TaskCandidateSequence0000000025000 implements MigrationInterface {
  name = 'TaskCandidateSequence0000000025000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_candidates"
      ADD COLUMN IF NOT EXISTS "sequence" integer NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "sla_started_at" timestamptz NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "task_candidates"
      SET "status" = 'PENDING'
      WHERE "status" = 'WAITING'
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      DROP COLUMN IF EXISTS "sla_started_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_candidates"
      DROP COLUMN IF EXISTS "sequence"
    `);
  }
}
