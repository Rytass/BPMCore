import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import {
  CreateApprovalTemplateInput,
  UpdateApprovalTemplateDraftInput,
  UpdateApprovalTemplateInput,
} from './dto/approval-template.input';
import { TemplateService } from './template.service';

@Resolver()
export class TemplateMutations {
  constructor(private readonly templateService: TemplateService) {}

  @Mutation(() => ApprovalTemplateEntity)
  async createApprovalTemplate(
    @Args('input') input: CreateApprovalTemplateInput,
  ): Promise<ApprovalTemplateEntity> {
    return this.templateService.createApprovalTemplate(input);
  }

  @Mutation(() => ApprovalTemplateEntity)
  async updateApprovalTemplate(
    @Args('input') input: UpdateApprovalTemplateInput,
  ): Promise<ApprovalTemplateEntity> {
    return this.templateService.updateApprovalTemplate(input);
  }

  @Mutation(() => ApprovalTemplateVersionEntity)
  async updateApprovalTemplateDraft(
    @Args('input') input: UpdateApprovalTemplateDraftInput,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.templateService.updateApprovalTemplateDraft(input);
  }

  @Mutation(() => ApprovalTemplateVersionEntity)
  async forkApprovalTemplate(
    @Args('templateId', { type: () => String }) templateId: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.templateService.forkApprovalTemplate(templateId);
  }

  @Mutation(() => ApprovalTemplateVersionEntity)
  async publishApprovalTemplateVersion(
    @Args('versionId', { type: () => String }) versionId: string,
    @Args('publishedByMemberId', { nullable: true, type: () => String })
    publishedByMemberId?: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.templateService.publishApprovalTemplateVersion(
      versionId,
      publishedByMemberId,
    );
  }

  @Mutation(() => ApprovalTemplateVersionEntity)
  async rollbackApprovalTemplateVersion(
    @Args('versionId', { type: () => String }) versionId: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.templateService.rollbackApprovalTemplateVersion(versionId);
  }
}
