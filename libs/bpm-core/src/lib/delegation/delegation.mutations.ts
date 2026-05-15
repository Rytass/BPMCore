import { ForbiddenException } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
  BPMAuthenticated,
  BPMAuthContext,
  BPMCurrentAuthContext,
  BPMCurrentMemberId,
  isBPMAdmin,
} from '../bpm-auth';
import {
  CreateDelegationRuleInput,
  UpdateDelegationRuleInput,
} from './dto/delegation-rule.input';
import { DelegationRuleEntity } from './delegation-rule.entity';
import { DelegationService } from './delegation.service';

@Resolver(() => DelegationRuleEntity)
@BPMAuthenticated()
export class DelegationMutations {
  constructor(private readonly delegationService: DelegationService) {}

  @Mutation(() => DelegationRuleEntity)
  createDelegationRule(
    @Args('input') input: CreateDelegationRuleInput,
    @BPMCurrentAuthContext() authContext: BPMAuthContext | null,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<DelegationRuleEntity> {
    assertCanWriteDelegationForPrincipal({
      authContext,
      principalMemberId: input.principalMemberId,
    });

    return this.delegationService.createDelegationRule({
      ...input,
      createdByMemberId: currentMemberId,
    });
  }

  @Mutation(() => DelegationRuleEntity)
  async updateDelegationRule(
    @Args('input') input: UpdateDelegationRuleInput,
    @BPMCurrentAuthContext() authContext: BPMAuthContext | null,
  ): Promise<DelegationRuleEntity> {
    const rule = await this.delegationService.getDelegationRule(input.id);

    assertCanWriteDelegationForPrincipal({
      authContext,
      principalMemberId: rule.principalMemberId,
    });

    return this.delegationService.updateDelegationRule(input);
  }

  @Mutation(() => DelegationRuleEntity)
  async revokeDelegationRule(
    @Args('id', { type: () => String }) id: string,
    @Args('revokedByMemberId', { nullable: true, type: () => String })
    revokedByMemberId?: string | null,
    @BPMCurrentAuthContext() authContext?: BPMAuthContext | null,
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<DelegationRuleEntity> {
    const rule = await this.delegationService.getDelegationRule(id);

    assertCanWriteDelegationForPrincipal({
      authContext,
      principalMemberId: rule.principalMemberId,
    });

    return this.delegationService.revokeDelegationRule({
      id,
      revokedByMemberId: currentMemberId ?? revokedByMemberId,
    });
  }
}

function assertCanWriteDelegationForPrincipal({
  authContext,
  principalMemberId,
}: {
  readonly authContext?: BPMAuthContext | null;
  readonly principalMemberId: string;
}): void {
  if (!authContext) {
    throw new ForbiddenException('BPM member context is required');
  }

  if (isBPMAdmin(authContext) || principalMemberId === authContext.memberId) {
    return;
  }

  throw new ForbiddenException('BPM admin permission is required');
}
