import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { FormDefinitionEntity } from './form-definition.entity';
import { FormDefinitionVersionEntity } from './form-definition-version.entity';
import { FormService } from './form.service';
import {
  CreateFormDefinitionInput,
  UpdateFormDefinitionDraftInput,
  UpdateFormDefinitionInput,
} from './dto/form-definition.input';

@Resolver()
export class FormMutations {
  constructor(private readonly formService: FormService) {}

  @Mutation(() => FormDefinitionEntity)
  async createFormDefinition(
    @Args('input') input: CreateFormDefinitionInput,
  ): Promise<FormDefinitionEntity> {
    return this.formService.createFormDefinition(input);
  }

  @Mutation(() => FormDefinitionEntity)
  async updateFormDefinition(
    @Args('input') input: UpdateFormDefinitionInput,
  ): Promise<FormDefinitionEntity> {
    return this.formService.updateFormDefinition(input);
  }

  @Mutation(() => FormDefinitionVersionEntity)
  async updateFormDefinitionDraft(
    @Args('input') input: UpdateFormDefinitionDraftInput,
  ): Promise<FormDefinitionVersionEntity> {
    return this.formService.updateFormDefinitionDraft(input);
  }

  @Mutation(() => FormDefinitionVersionEntity)
  async forkFormDefinition(
    @Args('formDefinitionId', { type: () => String }) formDefinitionId: string,
  ): Promise<FormDefinitionVersionEntity> {
    return this.formService.forkFormDefinition(formDefinitionId);
  }

  @Mutation(() => FormDefinitionVersionEntity)
  async publishFormDefinitionVersion(
    @Args('versionId', { type: () => String }) versionId: string,
    @Args('publishedByMemberId', { nullable: true, type: () => String })
    publishedByMemberId?: string,
  ): Promise<FormDefinitionVersionEntity> {
    return this.formService.publishFormDefinitionVersion(
      versionId,
      publishedByMemberId,
    );
  }

  @Mutation(() => FormDefinitionVersionEntity)
  async rollbackFormDefinitionVersion(
    @Args('versionId', { type: () => String }) versionId: string,
  ): Promise<FormDefinitionVersionEntity> {
    return this.formService.rollbackFormDefinitionVersion(versionId);
  }
}
