import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConditionModule } from '../condition/condition.module';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormModule } from '../form/form.module';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import { ComposeTemplateMutations } from './compose-template.mutations';
import { ExpressionDesignerQueries } from './expression-designer.queries';
import { ExpressionDesignerService } from './expression-designer.service';
import { TemplateMutations } from './template.mutations';
import { TemplateQueries } from './template.queries';
import { TemplateService } from './template.service';

@Module({
  imports: [
    ConditionModule,
    FormModule,
    TypeOrmModule.forFeature([
      ApprovalTemplateCategoryEntity,
      ApprovalTemplateEntity,
      ApprovalTemplateVersionEntity,
      FormDefinitionVersionEntity,
    ]),
  ],
  providers: [
    ComposeTemplateMutations,
    ExpressionDesignerQueries,
    ExpressionDesignerService,
    TemplateMutations,
    TemplateQueries,
    TemplateService,
  ],
  exports: [TemplateService],
})
export class TemplateModule {}
