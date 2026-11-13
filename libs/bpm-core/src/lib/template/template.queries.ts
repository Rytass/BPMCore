import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated } from '../bpm-auth';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';
import {
  ApprovalTemplateActivationStatusEnum,
  ApprovalTemplateCategoryStatusEnum,
  ApprovalTemplateListStatusEnum,
} from './template.enums';
import { TemplateService } from './template.service';

const INCLUDE_HOST_MANAGED_DESCRIPTION =
  'Also returns templates maintained by host code (hostManaged = true). Default false: they are left out. Not a lock: anyone who knows the id can still read or change them.';

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
    @Args('activationStatus', {
      nullable: true,
      type: () => ApprovalTemplateActivationStatusEnum,
    })
    activationStatus?: ApprovalTemplateActivationStatusEnum | null,
    @Args('includeHostManaged', {
      description: INCLUDE_HOST_MANAGED_DESCRIPTION,
      nullable: true,
      type: () => Boolean,
    })
    includeHostManaged?: boolean | null,
  ): Promise<readonly ApprovalTemplateEntity[]> {
    return this.templateService.listApprovalTemplates({
      activationStatus: activationStatus ?? undefined,
      includeHostManaged: includeHostManaged ?? undefined,
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
    @Args('activationStatus', {
      nullable: true,
      type: () => ApprovalTemplateActivationStatusEnum,
    })
    activationStatus?: ApprovalTemplateActivationStatusEnum | null,
    @Args('includeHostManaged', {
      description: INCLUDE_HOST_MANAGED_DESCRIPTION,
      nullable: true,
      type: () => Boolean,
    })
    includeHostManaged?: boolean | null,
  ): Promise<number> {
    return this.templateService.countApprovalTemplates({
      activationStatus: activationStatus ?? undefined,
      categoryId: categoryId ?? undefined,
      includeHostManaged: includeHostManaged ?? undefined,
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

  @Query(() => ApprovalTemplateEntity, {
    description:
      'Returns the live approval template with this host key. Soft-deleted templates are not matched. Host-managed templates are returned too; this query is not filtered by includeHostManaged.',
  })
  async approvalTemplateByKey(
    @Args('key', { type: () => String }) key: string,
  ): Promise<ApprovalTemplateEntity> {
    return this.templateService.getApprovalTemplateByKey(key);
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
