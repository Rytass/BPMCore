import { ForbiddenException } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import {
  BPMAuthenticated,
  BPMAuthContext,
  BPMCurrentAuthContext,
  isBPMAdmin,
} from '../bpm-auth';
import { DelegationRuleEntity } from './delegation-rule.entity';
import {
  DelegationRuleStatusEnum,
  DelegationScopeTypeEnum,
} from './delegation.enums';
import { DelegationService } from './delegation.service';

@Resolver(() => DelegationRuleEntity)
@BPMAuthenticated()
export class DelegationQueries {
  constructor(private readonly delegationService: DelegationService) {}

  @Query(() => [DelegationRuleEntity])
  delegationRules(
    @Args('principalMemberId', { nullable: true, type: () => String })
    principalMemberId?: string | null,
    @Args('agentMemberId', { nullable: true, type: () => String })
    agentMemberId?: string | null,
    @Args('includeInactive', { nullable: true, type: () => Boolean })
    includeInactive?: boolean | null,
    @Args('page', { nullable: true, type: () => Int })
    page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
    @Args('status', { nullable: true, type: () => DelegationRuleStatusEnum })
    status?: DelegationRuleStatusEnum | null,
    @Args('scopeType', { nullable: true, type: () => DelegationScopeTypeEnum })
    scopeType?: DelegationScopeTypeEnum | null,
    @BPMCurrentAuthContext() authContext?: BPMAuthContext | null,
  ): Promise<readonly DelegationRuleEntity[]> {
    assertDelegationRuleQueryAllowed({
      agentMemberId,
      authContext,
      principalMemberId,
    });

    return this.delegationService.listDelegationRules({
      agentMemberId,
      includeInactive: includeInactive ?? false,
      page: page ?? undefined,
      pageSize: pageSize ?? undefined,
      principalMemberId,
      scopeType,
      status: status ?? undefined,
    });
  }

  @Query(() => Int)
  delegationRuleCount(
    @Args('principalMemberId', { nullable: true, type: () => String })
    principalMemberId?: string | null,
    @Args('agentMemberId', { nullable: true, type: () => String })
    agentMemberId?: string | null,
    @Args('includeInactive', { nullable: true, type: () => Boolean })
    includeInactive?: boolean | null,
    @Args('status', { nullable: true, type: () => DelegationRuleStatusEnum })
    status?: DelegationRuleStatusEnum | null,
    @Args('scopeType', { nullable: true, type: () => DelegationScopeTypeEnum })
    scopeType?: DelegationScopeTypeEnum | null,
    @BPMCurrentAuthContext() authContext?: BPMAuthContext | null,
  ): Promise<number> {
    assertDelegationRuleQueryAllowed({
      agentMemberId,
      authContext,
      principalMemberId,
    });

    return this.delegationService.countDelegationRules({
      agentMemberId,
      includeInactive: includeInactive ?? false,
      principalMemberId,
      scopeType,
      status: status ?? undefined,
    });
  }
}

function assertDelegationRuleQueryAllowed({
  agentMemberId,
  authContext,
  principalMemberId,
}: {
  readonly agentMemberId?: string | null;
  readonly authContext?: BPMAuthContext | null;
  readonly principalMemberId?: string | null;
}): void {
  if (!authContext) {
    throw new ForbiddenException('BPM member context is required');
  }

  if (isBPMAdmin(authContext)) {
    return;
  }

  if (
    principalMemberId === authContext.memberId ||
    agentMemberId === authContext.memberId
  ) {
    return;
  }

  throw new ForbiddenException('BPM admin permission is required');
}
