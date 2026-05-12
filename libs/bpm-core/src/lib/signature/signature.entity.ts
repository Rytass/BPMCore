import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('signatures')
@ObjectType('Signature')
export class SignatureEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'instance_id' })
  @Field(() => ID)
  instanceId!: string;

  @Column('uuid', { name: 'task_id', nullable: true })
  @Field(() => ID, { nullable: true })
  taskId!: string | null;

  @Column('text', { name: 'signer_member_id' })
  @Field()
  signerMemberId!: string;

  @Column('text')
  @Field()
  algorithm!: string;

  @Column('jsonb', { name: 'signed_payload' })
  signedPayload!: Readonly<Record<string, unknown>>;

  @Column('text', { name: 'signed_payload_hash' })
  @Field()
  signedPayloadHash!: string;

  @Column('text')
  @Field()
  signature!: string;

  @Column('integer', { name: 'key_version' })
  @Field(() => Int)
  keyVersion!: number;

  @Column('text', { name: 'previous_signature_hash', nullable: true })
  @Field(() => String, { nullable: true })
  previousSignatureHash!: string | null;

  @Column('bytea', { name: 'timestamp_token', nullable: true })
  timestampToken!: Buffer | null;

  @Column('timestamptz', { name: 'signed_at' })
  @Field()
  signedAt!: Date;

  @Field()
  get signedPayloadJson(): string {
    return JSON.stringify(this.signedPayload ?? {});
  }

  @Field(() => String, { nullable: true })
  get timestampTokenBase64(): string | null {
    return this.timestampToken ? this.timestampToken.toString('base64') : null;
  }
}
