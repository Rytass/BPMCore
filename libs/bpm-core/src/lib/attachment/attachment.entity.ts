import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('attachments')
@ObjectType('Attachment')
export class AttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'instance_id', nullable: true })
  @Field(() => ID, { nullable: true })
  instanceId!: string | null;

  @Column('uuid', { name: 'task_id', nullable: true })
  @Field(() => ID, { nullable: true })
  taskId!: string | null;

  @Column('text', { name: 'form_field_path', nullable: true })
  @Field(() => String, { nullable: true })
  formFieldPath!: string | null;

  @Column('text', { name: 'uploader_member_id' })
  @Field()
  uploaderMemberId!: string;

  @Column('text')
  @Field()
  filename!: string;

  @Column('text', { name: 'mime_type' })
  @Field()
  mimeType!: string;

  @Column('bigint', { name: 'size_bytes' })
  @Field()
  sizeBytes!: string;

  @Column('text', { name: 'storage_provider' })
  @Field()
  storageProvider!: string;

  @Column('text', { name: 'storage_key' })
  @Field()
  storageKey!: string;

  @Column('text', { name: 'encryption_key_id', nullable: true })
  @Field(() => String, { nullable: true })
  encryptionKeyId!: string | null;

  @Column('text', { name: 'checksum_sha256' })
  @Field()
  checksumSha256!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;
}
