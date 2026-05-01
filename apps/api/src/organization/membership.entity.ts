import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('memberships')
@Unique(['memberId', 'orgUnitId', 'positionId', 'effectiveFrom'])
@ObjectType('Membership')
export class MembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text', { name: 'member_id' })
  @Field()
  memberId!: string;

  @Column('uuid', { name: 'org_unit_id' })
  @Field(() => ID)
  orgUnitId!: string;

  @Column('uuid', { name: 'position_id', nullable: true })
  @Field(() => ID, { nullable: true })
  positionId!: string | null;

  @Column('boolean', { default: false, name: 'is_primary' })
  @Field()
  isPrimary!: boolean;

  @Column('date', { name: 'effective_from' })
  @Field()
  effectiveFrom!: string;

  @Column('date', { name: 'effective_to', nullable: true })
  @Field({ nullable: true })
  effectiveTo!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;
}
