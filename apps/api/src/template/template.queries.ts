import { Args, Query, Resolver } from '@nestjs/graphql';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import { TemplateService } from './template.service';

@Resolver()
export class TemplateQueries {
  constructor(private readonly templateService: TemplateService) {}

  @Query(() => [ApprovalTemplateEntity])
  async approvalTemplates(): Promise<readonly ApprovalTemplateEntity[]> {
    return this.templateService.listApprovalTemplates();
  }

  @Query(() => ApprovalTemplateEntity)
  async approvalTemplate(
    @Args('id', { type: () => String }) id: string,
  ): Promise<ApprovalTemplateEntity> {
    return this.templateService.getApprovalTemplate(id);
  }

  @Query(() => [ApprovalTemplateVersionEntity])
  async approvalTemplateVersions(
    @Args('templateId', { type: () => String }) templateId: string,
  ): Promise<readonly ApprovalTemplateVersionEntity[]> {
    return this.templateService.listApprovalTemplateVersions(templateId);
  }

  @Query(() => ApprovalTemplateVersionEntity)
  async approvalTemplateVersion(
    @Args('id', { type: () => String }) id: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.templateService.getApprovalTemplateVersion(id);
  }
}
