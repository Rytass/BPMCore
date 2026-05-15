import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { BPMAdminOnly, BPMCurrentMemberId } from '../bpm-auth';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import {
  CreateApprovalTemplateCategoryInput,
  CreateApprovalTemplateInput,
  UpdateApprovalTemplateCategoryInput,
  UpdateApprovalTemplateDraftInput,
  UpdateApprovalTemplateInput,
} from './dto/approval-template.input';
import { TemplateService } from './template.service';

@Resolver()
@BPMAdminOnly()
export class TemplateMutations {
  constructor(private readonly templateService: TemplateService) {}

  @Mutation(() => ApprovalTemplateEntity)
  async createApprovalTemplate(
    @Args('input') input: CreateApprovalTemplateInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<ApprovalTemplateEntity> {
    return this.templateService.createApprovalTemplate({
      ...input,
      createdByMemberId: currentMemberId,
    });
  }

  @Mutation(() => ApprovalTemplateEntity)
  async updateApprovalTemplate(
    @Args('input') input: UpdateApprovalTemplateInput,
  ): Promise<ApprovalTemplateEntity> {
    return this.templateService.updateApprovalTemplate(input);
  }

  @Mutation(() => ApprovalTemplateCategoryEntity)
  async createApprovalTemplateCategory(
    @Args('input') input: CreateApprovalTemplateCategoryInput,
  ): Promise<ApprovalTemplateCategoryEntity> {
    return this.templateService.createApprovalTemplateCategory(input);
  }

  @Mutation(() => ApprovalTemplateCategoryEntity)
  async updateApprovalTemplateCategory(
    @Args('input') input: UpdateApprovalTemplateCategoryInput,
  ): Promise<ApprovalTemplateCategoryEntity> {
    return this.templateService.updateApprovalTemplateCategory(input);
  }

  @Mutation(() => ApprovalTemplateCategoryEntity)
  async activateApprovalTemplateCategory(
    @Args('id', { type: () => String }) id: string,
  ): Promise<ApprovalTemplateCategoryEntity> {
    return this.templateService.activateApprovalTemplateCategory(id);
  }

  @Mutation(() => ApprovalTemplateCategoryEntity)
  async deactivateApprovalTemplateCategory(
    @Args('id', { type: () => String }) id: string,
  ): Promise<ApprovalTemplateCategoryEntity> {
    return this.templateService.deactivateApprovalTemplateCategory(id);
  }

  @Mutation(() => ApprovalTemplateCategoryEntity)
  async deleteApprovalTemplateCategory(
    @Args('id', { type: () => String }) id: string,
  ): Promise<ApprovalTemplateCategoryEntity> {
    return this.templateService.deleteApprovalTemplateCategory(id);
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
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.templateService.publishApprovalTemplateVersion(
      versionId,
      currentMemberId ?? publishedByMemberId,
    );
  }

  @Mutation(() => ApprovalTemplateVersionEntity)
  async rollbackApprovalTemplateVersion(
    @Args('versionId', { type: () => String }) versionId: string,
  ): Promise<ApprovalTemplateVersionEntity> {
    return this.templateService.rollbackApprovalTemplateVersion(versionId);
  }
}
