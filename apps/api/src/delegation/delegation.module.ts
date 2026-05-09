import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConditionModule } from '../condition/condition.module';
import { DelegationRuleEntity } from './delegation-rule.entity';
import { DelegationMutations } from './delegation.mutations';
import { DelegationQueries } from './delegation.queries';
import { DelegationService } from './delegation.service';

@Module({
  imports: [ConditionModule, TypeOrmModule.forFeature([DelegationRuleEntity])],
  providers: [DelegationMutations, DelegationQueries, DelegationService],
  exports: [DelegationService],
})
export class DelegationModule {}
