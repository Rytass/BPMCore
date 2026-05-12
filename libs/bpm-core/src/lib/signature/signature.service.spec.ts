import { EntityManager, Repository } from 'typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { TaskDecisionActionEnum } from '../workflow-engine/workflow-engine.enums';
import { SignatureEntity } from './signature.entity';
import { SignatureService } from './signature.service';

describe('SignatureService', () => {
  it('creates verifiable chained HMAC signatures for task decisions', async (): Promise<void> => {
    const signatures: SignatureEntity[] = [];
    const repository = createSignatureRepository(signatures);
    const manager = createManager(repository);
    const service = new SignatureService();
    const instance = Object.assign(new ApprovalInstanceEntity(), {
      formData: { amount: 1200 },
      id: 'instance-1',
    });
    const task = Object.assign(new TaskEntity(), {
      id: 'task-1',
      nodeId: 'approval',
    });

    const firstSignature = await service.signTaskDecision(manager, {
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedAt: new Date('2026-05-10T10:00:00.000Z'),
      instance,
      returnToNodeId: null,
      signerMemberId: 'member-001',
      task,
      transferToMemberId: null,
    });
    const secondSignature = await service.signTaskDecision(manager, {
      action: TaskDecisionActionEnum.REJECTED,
      comment: '資料不足',
      decidedAt: new Date('2026-05-10T10:05:00.000Z'),
      instance,
      returnToNodeId: null,
      signerMemberId: 'member-001',
      task,
      transferToMemberId: null,
    });

    expect(firstSignature.previousSignatureHash).toBeNull();
    expect(secondSignature.previousSignatureHash).toBe(
      firstSignature.signedPayloadHash,
    );
    await expect(
      service.verifyInstanceSignatureChain(repository, instance.id),
    ).resolves.toMatchObject({
      checkedCount: 2,
      errors: [],
      valid: true,
    });
  });
});

function createSignatureRepository(
  signatures: SignatureEntity[],
): Repository<SignatureEntity> {
  const repository = {
    create: (entity: Partial<SignatureEntity>): SignatureEntity =>
      Object.assign(new SignatureEntity(), entity),
    find: (): Promise<readonly SignatureEntity[]> =>
      Promise.resolve(
        [...signatures].sort(
          (left, right) => left.signedAt.getTime() - right.signedAt.getTime(),
        ),
      ),
    findOne: (): Promise<SignatureEntity | null> =>
      Promise.resolve(signatures[signatures.length - 1] ?? null),
    save: (entity: SignatureEntity): Promise<SignatureEntity> => {
      const savedEntity = Object.assign(new SignatureEntity(), entity, {
        id: entity.id ?? `signature-${signatures.length + 1}`,
      });

      signatures.push(savedEntity);

      return Promise.resolve(savedEntity);
    },
  };

  return repository as unknown as Repository<SignatureEntity>;
}

function createManager(repository: Repository<SignatureEntity>): EntityManager {
  return {
    getRepository: (): Repository<SignatureEntity> => repository,
  } as unknown as EntityManager;
}
