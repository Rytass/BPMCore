import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { MemberMetadata } from '@rytass/bpm-core-shared';

@Entity('api_test_members')
export class ApiTestMemberEntity {
  @PrimaryColumn('text', { name: 'member_id' })
  memberId!: string;

  @Column('text', { unique: true })
  email!: string;

  @Column('text')
  name!: string;

  @Column('text', { name: 'password_hash' })
  passwordHash!: string;

  @Column('jsonb')
  roles!: readonly string[];

  @Column('jsonb')
  permissions!: readonly string[];

  @Column('jsonb', { default: () => "'{}'::jsonb", name: 'custom_fields' })
  customFields!: Readonly<Record<string, unknown>>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export function mapApiTestMemberToMetadata(
  member: ApiTestMemberEntity,
): MemberMetadata {
  return {
    customFields: member.customFields,
    email: member.email,
    memberId: member.memberId,
    name: member.name,
  };
}
