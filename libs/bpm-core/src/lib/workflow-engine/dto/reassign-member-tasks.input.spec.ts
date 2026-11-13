import { validate } from 'class-validator';
import { ReassignMemberTasksInput } from './reassign-member-tasks.input';

// Only a host that mounts a ValidationPipe runs these decorators; the service
// keeps its own guard for an empty list (see workflow-engine.service.spec.ts).
describe('ReassignMemberTasksInput', (): void => {
  const TASK_ID = '6f1c2a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

  const build = (taskIds?: string[] | null): ReassignMemberTasksInput => {
    const input = new ReassignMemberTasksInput();
    input.fromMemberId = 'member-from';
    input.reason = '離職';
    input.toMemberId = 'member-to';

    if (taskIds !== undefined) {
      input.taskIds = taskIds;
    }

    return input;
  };

  it('accepts an omitted taskIds', async (): Promise<void> => {
    expect(await validate(build())).toEqual([]);
  });

  it('accepts a null taskIds', async (): Promise<void> => {
    expect(await validate(build(null))).toEqual([]);
  });

  it('accepts a list of UUIDs', async (): Promise<void> => {
    expect(await validate(build([TASK_ID]))).toEqual([]);
  });

  it('rejects an empty taskIds', async (): Promise<void> => {
    expect(await validate(build([]))).toEqual([
      expect.objectContaining({ property: 'taskIds' }),
    ]);
  });

  it('rejects a taskIds entry that is not a UUID', async (): Promise<void> => {
    expect(await validate(build([TASK_ID, 'task-1']))).toEqual([
      expect.objectContaining({ property: 'taskIds' }),
    ]);
  });
});
