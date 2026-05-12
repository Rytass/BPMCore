import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
  CreateDelegationRuleInput,
  UpdateDelegationRuleInput,
} from './dto/delegation-rule.input';
import { DelegationRuleEntity } from './delegation-rule.entity';
import { DelegationService } from './delegation.service';

@Resolver(() => DelegationRuleEntity)
export class DelegationMutations {
  constructor(private readonly delegationService: DelegationService) {}

  @Mutation(() => DelegationRuleEntity)
  createDelegationRule(
    @Args('input') input: CreateDelegationRuleInput,
  ): Promise<DelegationRuleEntity> {
    return this.delegationService.createDelegationRule(input);
  }

  @Mutation(() => DelegationRuleEntity)
  updateDelegationRule(
    @Args('input') input: UpdateDelegationRuleInput,
  ): Promise<DelegationRuleEntity> {
    return this.delegationService.updateDelegationRule(input);
  }

  @Mutation(() => DelegationRuleEntity)
  revokeDelegationRule(
    @Args('id', { type: () => String }) id: string,
    @Args('revokedByMemberId', { nullable: true, type: () => String })
    revokedByMemberId?: string | null,
  ): Promise<DelegationRuleEntity> {
    return this.delegationService.revokeDelegationRule({
      id,
      revokedByMemberId,
    });
  }
}
