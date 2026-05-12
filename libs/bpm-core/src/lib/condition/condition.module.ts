import { Module } from '@nestjs/common';
import { ConditionService } from './condition.service';

@Module({
  providers: [ConditionService],
  exports: [ConditionService],
})
export class ConditionModule {}
