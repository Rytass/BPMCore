import type {
  OrgUnitRecord,
  PositionRecord,
} from '@rytass/bpm-core-client/organization';

export type OrgUnitOption = Readonly<{
  id: string;
  name: string;
}>;

export type PositionOption = Readonly<{
  id: string;
  name: string;
}>;

export function readOrgUnitOption(orgUnit: OrgUnitRecord): OrgUnitOption {
  return { id: orgUnit.id, name: `${orgUnit.name} · ${orgUnit.code}` };
}

export function readPositionOption(position: PositionRecord): PositionOption {
  return { id: position.id, name: `${position.name} · ${position.code}` };
}
