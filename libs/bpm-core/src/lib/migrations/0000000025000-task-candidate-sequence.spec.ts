import { QueryRunner } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from './index';
import { TaskCandidateSequence0000000025000 } from './0000000025000-task-candidate-sequence';

describe('TaskCandidateSequence0000000025000', () => {
  it('adds a nullable sequence column and drops it on rollback', async (): Promise<void> => {
    const query = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const migration = new TaskCandidateSequence0000000025000();
    const runner = { query } as unknown as QueryRunner;

    await migration.up(runner);
    await migration.down(runner);

    const statements = query.mock.calls.map(([sql]): string => sql);

    expect(statements[0]).toContain('ALTER TABLE "task_candidates"');
    expect(statements[0]).toContain(
      'ADD COLUMN IF NOT EXISTS "sequence" integer NULL',
    );
    expect(statements[1]).toContain('DROP COLUMN IF EXISTS "sequence"');
  });

  it('is registered in the migration list', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (migration): string => migration.name,
    );

    expect(names).toContain('TaskCandidateSequence0000000025000');
  });
});
