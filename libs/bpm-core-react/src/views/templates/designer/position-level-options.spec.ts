import {
  readDefaultMinPositionLevel,
  readMinPositionLevelOptions,
} from './position-level-options';

const POSITIONS = [
  { level: 3, name: '課長' },
  { level: 5, name: '處長' },
  { level: 5, name: '副處長' },
  { level: 1, name: '專員' },
] as const;

describe('readMinPositionLevelOptions', () => {
  it('lists each distinct level once, highest first, joining position names', () => {
    expect(readMinPositionLevelOptions(POSITIONS, 5)).toEqual([
      { id: '5', name: '職等 5（處長、副處長）', value: 5 },
      { id: '3', name: '職等 3（課長）', value: 3 },
      { id: '1', name: '職等 1（專員）', value: 1 },
    ]);
  });

  it('still offers a stored level that no position carries', () => {
    expect(
      readMinPositionLevelOptions(POSITIONS, 4).map((option) => option.name),
    ).toEqual([
      '職等 5（處長、副處長）',
      '職等 4',
      '職等 3（課長）',
      '職等 1（專員）',
    ]);
  });

  it('shows the stored level when no positions are loaded', () => {
    expect(readMinPositionLevelOptions([], 2)).toEqual([
      { id: '2', name: '職等 2', value: 2 },
    ]);
  });
});

describe('readDefaultMinPositionLevel', () => {
  it('is the highest level present', () => {
    expect(readDefaultMinPositionLevel(POSITIONS)).toBe(5);
  });

  it('is 1 when there are no positions', () => {
    expect(readDefaultMinPositionLevel([])).toBe(1);
  });
});
