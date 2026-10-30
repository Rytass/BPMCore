import type { TaskDecisionRecord } from '@rytass/bpm-core-client/workflow';
import {
  compareTaskDecisionDesc,
  readLatestTaskDecision,
  readLatestTaskDecisionsByTaskId,
} from './task-decision';

function decision(
  id: string,
  taskId: string,
  decidedAt: string,
): TaskDecisionRecord {
  return { decidedAt, id, taskId } as unknown as TaskDecisionRecord;
}

describe('readLatestTaskDecision', (): void => {
  it('picks the newest decision whatever the input order', (): void => {
    const newest = decision('d2', 'task-1', '2026-10-30T02:00:00.000Z');

    expect(
      readLatestTaskDecision([
        decision('d1', 'task-1', '2026-10-30T01:00:00.000Z'),
        newest,
        decision('d3', 'task-1', '2026-10-30T00:00:00.000Z'),
      ]),
    ).toBe(newest);
  });

  it('returns null when there is no decision', (): void => {
    expect(readLatestTaskDecision([])).toBeNull();
  });
});

describe('readLatestTaskDecisionsByTaskId', (): void => {
  it('keeps the newest decision of each task', (): void => {
    const latest = readLatestTaskDecisionsByTaskId([
      decision('a2', 'task-a', '2026-10-30T02:00:00.000Z'),
      decision('b1', 'task-b', '2026-10-30T01:00:00.000Z'),
      decision('a1', 'task-a', '2026-10-30T01:00:00.000Z'),
    ]);

    expect(latest.get('task-a')?.id).toBe('a2');
    expect(latest.get('task-b')?.id).toBe('b1');
  });

  it('settles a tie on the same decision as readLatestTaskDecision', (): void => {
    const tied = [
      decision('d1', 'task-1', '2026-10-30T01:00:00.000Z'),
      decision('d2', 'task-1', '2026-10-30T01:00:00.000Z'),
    ];

    expect(readLatestTaskDecisionsByTaskId(tied).get('task-1')).toBe(
      readLatestTaskDecision(tied),
    );
    expect(
      readLatestTaskDecisionsByTaskId([...tied].reverse()).get('task-1'),
    ).toBe(readLatestTaskDecision(tied));
  });
});

describe('compareTaskDecisionDesc', (): void => {
  it('sorts a time that does not parse as the oldest', (): void => {
    const valid = decision('d1', 'task-1', '2026-10-30T01:00:00.000Z');
    const invalid = decision('d2', 'task-1', 'not a time');

    expect(compareTaskDecisionDesc(valid, invalid)).toBeLessThan(0);
    expect(compareTaskDecisionDesc(invalid, valid)).toBeGreaterThan(0);
  });

  it('falls back to the id when neither time parses', (): void => {
    const first = decision('d1', 'task-1', 'not a time');
    const second = decision('d2', 'task-1', 'also not a time');

    expect(compareTaskDecisionDesc(first, second)).toBeGreaterThan(0);
    expect(Number.isNaN(compareTaskDecisionDesc(first, second))).toBe(false);
  });
});
