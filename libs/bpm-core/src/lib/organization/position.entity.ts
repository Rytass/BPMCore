import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('positions')
@ObjectType('Position')
export class PositionEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text', { unique: true })
  @Field()
  code!: string;

  @Column('text')
  @Field()
  name!: string;

  @Column('int')
  @Field(() => Int)
  level!: number;

  @Column('jsonb', { default: {} })
  metadata!: Readonly<Record<string, unknown>>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;
}
