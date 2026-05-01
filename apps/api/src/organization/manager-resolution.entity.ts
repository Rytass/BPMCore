import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ManagerResolutionScopeTypeEnum } from './organization.enums';

@Entity('manager_resolutions')
@ObjectType('ManagerResolution')
export class ManagerResolutionEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text', { name: 'scope_type' })
  @Field(() => ManagerResolutionScopeTypeEnum)
  scopeType!: ManagerResolutionScopeTypeEnum;

  @Column('text', { name: 'scope_id' })
  @Field()
  scopeId!: string;

  @Column('text', { name: 'manager_member_id' })
  @Field()
  managerMemberId!: string;

  @Column('int')
  @Field(() => Int)
  priority!: number;

  @Column('date', { name: 'effective_from' })
  @Field()
  effectiveFrom!: string;

  @Column('date', { name: 'effective_to', nullable: true })
  @Field({ nullable: true })
  effectiveTo!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;
}
