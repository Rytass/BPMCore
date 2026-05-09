import { Args, Query, Resolver } from '@nestjs/graphql';
import { DelegationRuleEntity } from './delegation-rule.entity';
import { DelegationService } from './delegation.service';

@Resolver(() => DelegationRuleEntity)
export class DelegationQueries {
  constructor(private readonly delegationService: DelegationService) {}

  @Query(() => [DelegationRuleEntity])
  delegationRules(
    @Args('principalMemberId', { nullable: true, type: () => String })
    principalMemberId?: string | null,
    @Args('includeInactive', { nullable: true, type: () => Boolean })
    includeInactive?: boolean | null,
  ): Promise<readonly DelegationRuleEntity[]> {
    return this.delegationService.listDelegationRules({
      includeInactive: includeInactive ?? false,
      principalMemberId,
    });
  }
}
