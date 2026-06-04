import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { BPMCurrentMemberId, BPMDesignerOnly } from '../bpm-auth';
import { ComposeApprovalTemplateWithFormObject } from './compose-approval-template.object';
import { ComposeApprovalTemplateWithFormInput } from './dto/compose-approval-template.input';
import { TemplateService } from './template.service';

@Resolver()
@BPMDesignerOnly()
export class ComposeTemplateMutations {
  constructor(private readonly templateService: TemplateService) {}

  @Mutation(() => ComposeApprovalTemplateWithFormObject)
  async composeApprovalTemplateWithForm(
    @Args('input') input: ComposeApprovalTemplateWithFormInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<ComposeApprovalTemplateWithFormObject> {
    return this.templateService.composeApprovalTemplateWithForm(
      input,
      currentMemberId,
    );
  }
}
