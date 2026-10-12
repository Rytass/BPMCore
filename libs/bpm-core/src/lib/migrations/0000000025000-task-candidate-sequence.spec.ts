import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { TaskCandidateSequence0000000025000 } from './0000000025000-task-candidate-sequence';

describe('TaskCandidateSequence0000000025000', () => {
  it('adds the nullable sequence and SLA start columns', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new TaskCandidateSequence0000000025000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('ALTER TABLE "task_candidates"');
    expect(statements[0]).toContain(
      'ADD COLUMN IF NOT EXISTS "sequence" integer NULL',
    );
    expect(statements[1]).toContain('ALTER TABLE "tasks"');
    expect(statements[1]).toContain(
      'ADD COLUMN IF NOT EXISTS "sla_started_at" timestamptz NULL',
    );
  });

  it('hands waiting candidates back to PENDING before dropping the columns', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new TaskCandidateSequence0000000025000();

    await migration.down({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    // Without `sequence` nothing can activate a WAITING candidate, so the
    // rollback must free them first or their tasks are stranded.
    expect(statements[0]).toContain('UPDATE "task_candidates"');
    expect(statements[0]).toContain(`SET "status" = 'PENDING'`);
    expect(statements[0]).toContain(`WHERE "status" = 'WAITING'`);
    expect(statements.slice(1).join('\n')).toContain(
      'DROP COLUMN IF EXISTS "sla_started_at"',
    );
    expect(statements.slice(1).join('\n')).toContain(
      'DROP COLUMN IF EXISTS "sequence"',
    );
  });

  it('is registered in the migration list', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (migration): string => migration.name,
    );

    expect(names).toContain('TaskCandidateSequence0000000025000');
  });
});
