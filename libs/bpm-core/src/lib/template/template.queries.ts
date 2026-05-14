import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated } from '../bpm-auth';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import {
  ApprovalTemplateCategoryStatusEnum,
  ApprovalTemplateListStatusEnum,
} from './template.enums';
import { TemplateService } from './template.service';

@Resolver()
@BPMAuthenticated()
export class TemplateQueries {
  constructor(private readonly templateService: TemplateService) {}

  @Query(() => [ApprovalTemplateEntity])
  async approvalTemplates(
    @Args('page', { nullable: true, type: () => Int })
    page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
    @Args('categoryId', { nullable: true, type: () => String })
    categoryId?: string | null,
    @Args('status', {
      nullable: true,
      type: () => ApprovalTemplateListStatusEnum,
    })
    status?: ApprovalTemplateListStatusEnum | null,
  ): Promise<readonly ApprovalTemplateEntity[]> {
    return this.templateService.listApprovalTemplates({
      page: page ?? undefined,
      pageSize: pageSize ?? undefined,
      categoryId: categoryId ?? undefined,
      searchText: searchText ?? undefined,
      status: status ?? undefined,
    });
  }

  @Query(() => Int)
  async approvalTemplateCount(
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
    @Args('categoryId', { nullable: true, type: () => String })
    categoryId?: string | null,
    @Args('status', {
      nullable: true,
      type: () => ApprovalTemplateListStatusEnum,
    })
    status?: ApprovalTemplateListStatusEnum | null,
  ): Promise<number> {
    return this.templateService.countApprovalTemplates({
      categoryId: categoryId ?? undefined,
      searchText: searchText ?? undefined,
      status: status ?? undefined,
    });
  }

  @Query(() => [ApprovalTemplateCategoryEntity])
  async approvalTemplateCategories(
    @Args('page', { nullable: true, type: () => Int })
    page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
    @Args('status', {
      nullable: true,
      type: () => ApprovalTemplateCategoryStatusEnum,
    })
    status?: ApprovalTemplateCategoryStatusEnum | null,
  ): Promise<readonly ApprovalTemplateCategoryEntity[]> {
    return this.templateService.listApprovalTemplateCategories({
      page: page ?? undefined,
      pageSize: pageSize ?? undefined,
      searchText: searchText ?? undefined,
      status: status ?? undefined,
    });
  }

  @Query(() => Int)
  async approvalTemplateCategoryCount(
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
    @Args('status', {
      nullable: true,
      type: () => ApprovalTemplateCategoryStatusEnum,
    })
    status?: ApprovalTemplateCategoryStatusEnum | null,
  ): Promise<number> {
    return this.templateService.countApprovalTemplateCategories({
      searchText: searchText ?? undefined,
      status: status ?? undefined,
    });
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
