import { registerEnumType } from '@nestjs/graphql';

export enum DelegationRuleStatusEnum {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

export enum DelegationScopeTypeEnum {
  ALL = 'ALL',
  CONDITION_BASED = 'CONDITION_BASED',
  TEMPLATE_LIST = 'TEMPLATE_LIST',
}

registerEnumType(DelegationRuleStatusEnum, {
  name: 'DelegationRuleStatus',
});

registerEnumType(DelegationScopeTypeEnum, {
  name: 'DelegationScopeType',
});
