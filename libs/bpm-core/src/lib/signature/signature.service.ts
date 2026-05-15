import { createHash, createHmac } from 'crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskDecisionActionEnum } from '../workflow-engine/workflow-engine.enums';
import { TaskEntity } from '../workflow-engine/task.entity';
import { SignatureEntity } from './signature.entity';
import {
  BPMResolvedSignatureOptions,
  BPM_SIGNATURE_OPTIONS,
  DEFAULT_BPM_SIGNATURE_OPTIONS,
} from './signature-options';
import { SignatureVerificationObject } from './signature-verification.object';

const SIGNATURE_ALGORITHM = 'HMAC-SHA256';

export interface SignTaskDecisionInput {
  readonly action: TaskDecisionActionEnum;
  readonly comment: string | null;
  readonly decidedAt: Date;
  readonly instance: ApprovalInstanceEntity;
  readonly returnToNodeId: string | null;
  readonly signerMemberId: string;
  readonly task: TaskEntity;
  readonly transferToMemberId: string | null;
}

@Injectable()
export class SignatureService {
  constructor(
    @Optional()
    @Inject(BPM_SIGNATURE_OPTIONS)
    private readonly signatureOptions: BPMResolvedSignatureOptions = DEFAULT_BPM_SIGNATURE_OPTIONS,
  ) {}

  async signTaskDecision(
    manager: EntityManager,
    input: SignTaskDecisionInput,
  ): Promise<SignatureEntity> {
    const signatureRepository = manager.getRepository(SignatureEntity);
    const previousSignature = await this.readLatestSignature(
      signatureRepository,
      input.instance.id,
    );
    const payload = buildTaskDecisionSignedPayload(input);
    const signedPayloadHash = hashStableJson(payload);
    const keyVersion = this.signatureOptions.currentKeyVersion;
    const signature = await signHash(
      signedPayloadHash,
      keyVersion,
      this.signatureOptions,
    );

    return signatureRepository.save(
      signatureRepository.create({
        algorithm: SIGNATURE_ALGORITHM,
        instanceId: input.instance.id,
        keyVersion,
        previousSignatureHash: previousSignature?.signedPayloadHash ?? null,
        signedAt: input.decidedAt,
        signedPayload: payload,
        signedPayloadHash,
        signature,
        signerMemberId: input.signerMemberId,
        taskId: input.task.id,
        timestampToken:
          await this.signatureOptions.timestampProvider.createTimestampToken({
            signedAt: input.decidedAt,
            signedPayloadHash,
          }),
      }),
    );
  }

  async listSignatures(
    signatureRepository: Repository<SignatureEntity>,
    instanceId: string,
  ): Promise<readonly SignatureEntity[]> {
    return signatureRepository.find({
      order: { signedAt: 'ASC', id: 'ASC' },
      where: { instanceId },
    });
  }

  async verifyInstanceSignatureChain(
    signatureRepository: Repository<SignatureEntity>,
    instanceId: string,
  ): Promise<SignatureVerificationObject> {
    const signatures = await this.listSignatures(
      signatureRepository,
      instanceId,
    );
    const errors = (
      await Promise.all(
        signatures.map((signature, index) =>
          verifySignatureAt(
            signature,
            signatures[index - 1] ?? null,
            this.signatureOptions,
          ),
        ),
      )
    ).flatMap((signatureErrors) => signatureErrors);

    return Object.assign(new SignatureVerificationObject(), {
      checkedCount: signatures.length,
      errors,
      instanceId,
      valid: errors.length === 0,
    });
  }

  private async readLatestSignature(
    signatureRepository: Repository<SignatureEntity>,
    instanceId: string,
  ): Promise<SignatureEntity | null> {
    return signatureRepository.findOne({
      order: { signedAt: 'DESC', id: 'DESC' },
      where: { instanceId },
    });
  }
}

function buildTaskDecisionSignedPayload(
  input: SignTaskDecisionInput,
): Readonly<Record<string, unknown>> {
  return {
    action: input.action,
    comment: input.comment,
    decidedAt: input.decidedAt.toISOString(),
    formDataHash: hashStableJson(input.instance.formData),
    instanceId: input.instance.id,
    nodeId: input.task.nodeId,
    returnToNodeId: input.returnToNodeId,
    signerMemberId: input.signerMemberId,
    taskId: input.task.id,
    transferToMemberId: input.transferToMemberId,
  };
}

async function verifySignatureAt(
  signature: SignatureEntity,
  previousSignature: SignatureEntity | null,
  options: BPMResolvedSignatureOptions,
): Promise<readonly string[]> {
  const payloadHash = hashStableJson(signature.signedPayload);
  const expectedSignature = await signHash(
    payloadHash,
    signature.keyVersion,
    options,
  );
  const expectedPreviousHash = previousSignature?.signedPayloadHash ?? null;

  return [
    payloadHash === signature.signedPayloadHash
      ? null
      : `Signature ${signature.id} payload hash mismatch`,
    expectedSignature === signature.signature
      ? null
      : `Signature ${signature.id} HMAC mismatch`,
    expectedPreviousHash === signature.previousSignatureHash
      ? null
      : `Signature ${signature.id} previous hash mismatch`,
  ].filter(isPresentText);
}

async function signHash(
  signedPayloadHash: string,
  keyVersion: number,
  options: BPMResolvedSignatureOptions,
): Promise<string> {
  const key = await options.keyProvider.readKey(keyVersion);

  if (!key) {
    throw new Error(`Unsupported signature key version: ${keyVersion}`);
  }

  return createHmac('sha256', key).update(signedPayloadHash).digest('base64');
}

function hashStableJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(',')}}`;
}

function isPresentText(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0;
}
