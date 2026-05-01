import { registerEnumType } from '@nestjs/graphql';

export enum OrgUnitTypeEnum {
  COMPANY = 'company',
  DIVISION = 'division',
  DEPARTMENT = 'department',
  TEAM = 'team',
}

export enum ManagerResolutionScopeTypeEnum {
  MEMBER = 'MEMBER',
  ORG_UNIT = 'ORG_UNIT',
  POSITION = 'POSITION',
}

registerEnumType(OrgUnitTypeEnum, { name: 'OrgUnitType' });
registerEnumType(ManagerResolutionScopeTypeEnum, {
  name: 'ManagerResolutionScopeType',
});
