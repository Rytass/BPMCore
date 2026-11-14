import { validate } from 'class-validator';
import { AdminCancelApprovalInstanceInput } from './admin-cancel-approval-instance.input';

// Only a host that mounts a ValidationPipe runs these decorators; the service
// keeps its own guard for a reason that is only whitespace (see
// workflow-engine.service.spec.ts).
describe('AdminCancelApprovalInstanceInput', (): void => {
  const INSTANCE_ID = '6f1c2a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

  const build = (
    instanceId: string,
    reason: string,
  ): AdminCancelApprovalInstanceInput => {
    const input = new AdminCancelApprovalInstanceInput();
    input.instanceId = instanceId;
    input.reason = reason;

    return input;
  };

  it('accepts a UUID instance id and a reason', async (): Promise<void> => {
    expect(await validate(build(INSTANCE_ID, '申請人已離職'))).toEqual([]);
  });

  it('rejects an empty reason', async (): Promise<void> => {
    expect(await validate(build(INSTANCE_ID, ''))).toEqual([
      expect.objectContaining({ property: 'reason' }),
    ]);
  });

  it('rejects an instance id that is not a UUID', async (): Promise<void> => {
    expect(await validate(build('instance-1', '申請人已離職'))).toEqual([
      expect.objectContaining({ property: 'instanceId' }),
    ]);
  });
});
