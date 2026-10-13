import {
  mergeMemberFieldOptions,
  readMemberFieldOption,
  readMemberFieldValue,
  readSelectedMemberFieldOptions,
  readUnresolvedMemberFieldOption,
  readUnresolvedMemberIds,
  UNKNOWN_MEMBER_NAME,
} from './member-field-options';

const ALICE = { id: 'm1', name: 'Alice (alice@example.com)' };
const BOB = { id: 'm2', name: 'Bob (bob@example.com)' };

describe('readMemberFieldOption', () => {
  it('labels a member with name and email, keyed by member id', () => {
    expect(
      readMemberFieldOption({
        email: 'alice@example.com',
        memberId: 'm1',
        name: 'Alice',
      }),
    ).toEqual(ALICE);
  });

  it('drops the empty parentheses when a member has no email', () => {
    expect(
      readMemberFieldOption({ email: '', memberId: 'm1', name: 'Alice' }),
    ).toEqual({ id: 'm1', name: 'Alice' });
  });
});

describe('readSelectedMemberFieldOptions', () => {
  it('shows names for stored ids, in stored order', () => {
    expect(readSelectedMemberFieldOptions(['m2', 'm1'], [ALICE, BOB])).toEqual([
      BOB,
      ALICE,
    ]);
    expect(readSelectedMemberFieldOptions('m1', [ALICE, BOB])).toEqual([ALICE]);
  });

  it('keeps an id nobody can name visible as an unknown member', () => {
    expect(readSelectedMemberFieldOptions(['m9'], [ALICE])).toEqual([
      { id: 'm9', name: UNKNOWN_MEMBER_NAME, unresolved: true },
    ]);
  });

  it('selects nothing for an empty value', () => {
    expect(readSelectedMemberFieldOptions(undefined, [ALICE])).toEqual([]);
    expect(readSelectedMemberFieldOptions([], [ALICE])).toEqual([]);
  });
});

describe('readUnresolvedMemberIds', () => {
  it('lists stored ids that have no resolved profile yet', () => {
    expect(readUnresolvedMemberIds(['m1', 'm2'], [ALICE])).toEqual(['m2']);
    expect(
      readUnresolvedMemberIds('m1', [readUnresolvedMemberFieldOption('m1')]),
    ).toEqual(['m1']);
    expect(readUnresolvedMemberIds(['m1'], [ALICE])).toEqual([]);
    expect(readUnresolvedMemberIds(undefined, [])).toEqual([]);
  });
});

describe('mergeMemberFieldOptions', () => {
  it('returns the same array when nothing is new', () => {
    const current = [ALICE, BOB];

    expect(mergeMemberFieldOptions(current, [BOB])).toBe(current);
  });

  it('appends unseen members once', () => {
    expect(mergeMemberFieldOptions([ALICE], [BOB, BOB])).toEqual([ALICE, BOB]);
  });

  it('replaces an unresolved placeholder once the real profile turns up', () => {
    expect(
      mergeMemberFieldOptions([readUnresolvedMemberFieldOption('m1')], [ALICE]),
    ).toEqual([ALICE]);
  });

  it('never lets a placeholder replace a resolved member', () => {
    const current = [ALICE];

    expect(
      mergeMemberFieldOptions(current, [readUnresolvedMemberFieldOption('m1')]),
    ).toBe(current);
  });
});

describe('readMemberFieldValue', () => {
  it('writes nothing back when nobody is picked', () => {
    expect(readMemberFieldValue([], false)).toBeUndefined();
    expect(readMemberFieldValue([], true)).toBeUndefined();
  });

  it('writes the member id for a single field', () => {
    expect(readMemberFieldValue([ALICE], false)).toBe('m1');
  });

  it('writes member ids, never options, for a multiple field', () => {
    expect(readMemberFieldValue([ALICE, BOB], true)).toEqual(['m1', 'm2']);
  });
});
