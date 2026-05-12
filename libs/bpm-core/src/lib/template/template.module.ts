import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConditionModule } from '../condition/condition.module';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import { TemplateMutations } from './template.mutations';
import { TemplateQueries } from './template.queries';
import { TemplateService } from './template.service';

@Module({
  imports: [
    ConditionModule,
    TypeOrmModule.forFeature([
      ApprovalTemplateEntity,
      ApprovalTemplateVersionEntity,
      FormDefinitionVersionEntity,
    ]),
  ],
  providers: [TemplateMutations, TemplateQueries, TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
