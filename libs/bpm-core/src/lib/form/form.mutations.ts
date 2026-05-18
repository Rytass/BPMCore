import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { BPMCurrentMemberId, BPMDesignerOnly } from '../bpm-auth';
import { FormDefinitionEntity } from './form-definition.entity';
import { FormDefinitionVersionEntity } from './form-definition-version.entity';
import { FormService } from './form.service';
import {
  CreateFormDefinitionInput,
  UpdateFormDefinitionDraftInput,
  UpdateFormDefinitionInput,
} from './dto/form-definition.input';

@Resolver()
@BPMDesignerOnly()
export class FormMutations {
  constructor(private readonly formService: FormService) {}

  @Mutation(() => FormDefinitionEntity)
  async createFormDefinition(
    @Args('input') input: CreateFormDefinitionInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<FormDefinitionEntity> {
    return this.formService.createFormDefinition({
      ...input,
      createdByMemberId: currentMemberId,
    });
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
    _publishedByMemberId: string | null | undefined,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<FormDefinitionVersionEntity> {
    return this.formService.publishFormDefinitionVersion(
      versionId,
      currentMemberId,
    );
  }

  @Mutation(() => FormDefinitionVersionEntity)
  async rollbackFormDefinitionVersion(
    @Args('versionId', { type: () => String }) versionId: string,
  ): Promise<FormDefinitionVersionEntity> {
    return this.formService.rollbackFormDefinitionVersion(versionId);
  }
}
