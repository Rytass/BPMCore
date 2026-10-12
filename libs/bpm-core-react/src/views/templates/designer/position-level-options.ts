import { PositionRecord } from '@rytass/bpm-core-client/organization';

export type PositionLevelOption = Readonly<{
  id: string;
  name: string;
  value: number;
}>;

type PositionLevelSource = Pick<PositionRecord, 'level' | 'name'>;

/**
 * One option per distinct position level in the directory, highest first, each
 * labelled with the positions sitting on that level. A saved level that no
 * position carries (positions deleted or not loaded yet) is still offered so
 * the select never renders blank and the stored value is not silently changed.
 */
export function readMinPositionLevelOptions(
  positions: readonly PositionLevelSource[],
  currentLevel: number,
): readonly PositionLevelOption[] {
  const levels = [...new Set(positions.map((position) => position.level))];
  const allLevels = levels.includes(currentLevel)
    ? levels
    : [...levels, currentLevel];

  return [...allLevels]
    .sort((left, right) => right - left)
    .map((level) => {
      const names = positions
        .filter((position) => position.level === level)
        .map((position) => position.name);

      return {
        id: String(level),
        name:
          names.length > 0
            ? `職等 ${level}（${names.join('、')}）`
            : `職等 ${level}`,
        value: level,
      };
    });
}

/** The highest level in the directory, or `1` when there are no positions. */
export function readDefaultMinPositionLevel(
  positions: readonly PositionLevelSource[],
): number {
  return positions.reduce(
    (highest, position) => Math.max(highest, position.level),
    1,
  );
}
