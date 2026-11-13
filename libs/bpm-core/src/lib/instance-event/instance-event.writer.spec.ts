import type { EntityManager } from 'typeorm';
import { ApprovalInstanceStateEnum } from '../workflow-engine/workflow-engine.enums';
import { ApprovalInstanceEventEntity } from './approval-instance-event.entity';
import type { BPMInstanceEventObserver } from './instance-event.token';
import { InstanceEventService } from './instance-event.service';
import type { BPMInstanceEventSnapshot } from './instance-event.types';
import { InstanceEventWriter } from './instance-event.writer';

const snapshot: BPMInstanceEventSnapshot = {
  instanceState: ApprovalInstanceStateEnum.RUNNING,
  templateId: 'template-1',
  templateKey: 'expense',
  templateVersionId: 'version-1',
};

function createManager(): {
  readonly manager: EntityManager;
  readonly save: jest.Mock;
} {
  const save = jest.fn((row: unknown): Promise<unknown> =>
    Promise.resolve(row),
  );
  const repository = {
    create: (value: unknown): unknown => value,
    save,
  };
  const manager = {
    getRepository: (entity: unknown): unknown => {
      expect(entity).toBe(ApprovalInstanceEventEntity);

      return repository;
    },
  } as unknown as EntityManager;

  return { manager, save };
}

function createWriter(
  observer: BPMInstanceEventObserver | null,
): InstanceEventWriter {
  const service = {
    enabled: observer !== null,
    observer,
  } as unknown as InstanceEventService;

  return new InstanceEventWriter(service);
}

describe('InstanceEventWriter', (): void => {
  it('writes nothing when no observer is bound', async (): Promise<void> => {
    const { manager, save } = createManager();
    const writer = createWriter(null);

    await writer.record(
      manager,
      'instance-1',
      snapshot,
      'INSTANCE_APPROVED',
      {},
    );

    expect(save).not.toHaveBeenCalled();
  });

  it('saves one row with the snapshot merged into the payload', async (): Promise<void> => {
    const { manager, save } = createManager();
    const writer = createWriter({ onInstanceEvent: (): void => undefined });

    await writer.record(manager, 'instance-1', snapshot, 'INSTANCE_RETURNED', {
      actorMemberId: 'member-2',
      nodeId: 'node-3',
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      instanceId: 'instance-1',
      payload: {
        actorMemberId: 'member-2',
        instanceState: ApprovalInstanceStateEnum.RUNNING,
        nodeId: 'node-3',
        templateId: 'template-1',
        templateKey: 'expense',
        templateVersionId: 'version-1',
      },
      type: 'INSTANCE_RETURNED',
    });
  });

  it('never stores formData in the payload', async (): Promise<void> => {
    const { manager, save } = createManager();
    const writer = createWriter({ onInstanceEvent: (): void => undefined });

    await writer.record(manager, 'instance-1', snapshot, 'INSTANCE_SUBMITTED', {
      actorMemberId: null,
    });

    const saved = save.mock.calls[0]?.[0] as { payload: object };

    expect(saved.payload).not.toHaveProperty('formData');
  });
});
