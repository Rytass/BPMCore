import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { MemberMetadata } from '@rytass/bpm-core-shared';

@Entity('member_metadata_cache')
@Unique(['memberId'])
@ObjectType('MemberMetadataCache')
export class MemberMetadataCacheEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text', { name: 'member_id' })
  @Field()
  memberId!: string;

  @Column('jsonb')
  metadata!: MemberMetadata;

  @Column('timestamptz', { name: 'fetched_at' })
  @Field()
  fetchedAt!: Date;

  @Column('timestamptz', { name: 'expires_at' })
  @Field()
  expiresAt!: Date;
}
