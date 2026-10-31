import {
  DELETED_ORG_UNIT_SUFFIX,
  mergeOrgUnitFieldOptions,
  readOrgUnitFieldOption,
  readOrgUnitFieldValue,
  readPendingOrgUnitFieldOption,
  readSelectedOrgUnitFieldOption,
  readUnknownOrgUnitFieldOption,
  readUnresolvedOrgUnitId,
  UNKNOWN_ORG_UNIT_NAME,
} from './org-unit-field-options';

const FINANCE = { id: 'u1', name: '財務部' };
const SALES = { id: 'u2', name: '業務部' };

describe('readOrgUnitFieldOption', () => {
  it('names a live unit by its name, keyed by unit id', () => {
    expect(
      readOrgUnitFieldOption({
        code: 'FIN',
        deleted: false,
        id: 'u1',
        name: '財務部',
      }),
    ).toEqual(FINANCE);
  });

  it('marks a deleted unit after its name', () => {
    expect(
      readOrgUnitFieldOption({
        code: 'OLD',
        deleted: true,
        id: 'u3',
        name: '舊部門',
      }),
    ).toEqual({ id: 'u3', name: `舊部門${DELETED_ORG_UNIT_SUFFIX}` });
    expect(DELETED_ORG_UNIT_SUFFIX).toBe('（已刪除）');
  });
});

describe('placeholders', () => {
  it('shows the id while the name has not come back', () => {
    expect(readPendingOrgUnitFieldOption('u9')).toEqual({
      id: 'u9',
      name: 'u9',
      unresolved: true,
    });
  });

  it('shows 未知組織 for a unit nobody can name', () => {
    expect(UNKNOWN_ORG_UNIT_NAME).toBe('未知組織');
    expect(readUnknownOrgUnitFieldOption('u9')).toEqual({
      id: 'u9',
      name: '未知組織',
      unresolved: true,
    });
  });
});

describe('readSelectedOrgUnitFieldOption', () => {
  it('shows the name of the stored id', () => {
    expect(readSelectedOrgUnitFieldOption('u2', [FINANCE, SALES])).toEqual(
      SALES,
    );
  });

  it('matches ids without regard to case, as the server lowercases them', () => {
    expect(readSelectedOrgUnitFieldOption('U1', [FINANCE])).toEqual(FINANCE);
  });

  it('shows the id as a placeholder until a name is known', () => {
    expect(readSelectedOrgUnitFieldOption('u9', [FINANCE])).toEqual({
      id: 'u9',
      name: 'u9',
      unresolved: true,
    });
  });

  it('keeps showing 未知組織 once the id was given up on', () => {
    expect(
      readSelectedOrgUnitFieldOption('u9', [
        FINANCE,
        readUnknownOrgUnitFieldOption('u9'),
      ]),
    ).toEqual({ id: 'u9', name: '未知組織', unresolved: true });
  });

  it('selects nothing for an empty or non-string value', () => {
    expect(readSelectedOrgUnitFieldOption(undefined, [FINANCE])).toBeNull();
    expect(readSelectedOrgUnitFieldOption('', [FINANCE])).toBeNull();
    expect(readSelectedOrgUnitFieldOption(['u1'], [FINANCE])).toBeNull();
  });
});

describe('readUnresolvedOrgUnitId', () => {
  it('asks for a stored id no option covers yet', () => {
    expect(readUnresolvedOrgUnitId('u9', [FINANCE])).toBe('u9');
  });

  it('does not ask again for a named id or one already given up on', () => {
    expect(readUnresolvedOrgUnitId('u1', [FINANCE])).toBeNull();
    expect(
      readUnresolvedOrgUnitId('u9', [readUnknownOrgUnitFieldOption('u9')]),
    ).toBeNull();
  });

  it('has nothing to ask for when nothing is stored', () => {
    expect(readUnresolvedOrgUnitId(undefined, [])).toBeNull();
  });
});

describe('mergeOrgUnitFieldOptions', () => {
  it('adds new options once and keeps the first one seen', () => {
    expect(
      mergeOrgUnitFieldOptions(
        [FINANCE],
        [{ id: 'u1', name: '改名' }, SALES, SALES],
      ),
    ).toEqual([FINANCE, SALES]);
  });

  it('lets a named option replace an unresolved placeholder', () => {
    expect(
      mergeOrgUnitFieldOptions(
        [readUnknownOrgUnitFieldOption('u2'), FINANCE],
        [SALES],
      ),
    ).toEqual([SALES, FINANCE]);
  });

  it('never lets a placeholder replace anything', () => {
    expect(
      mergeOrgUnitFieldOptions(
        [FINANCE],
        [readUnknownOrgUnitFieldOption('u1')],
      ),
    ).toEqual([FINANCE]);
  });

  it('returns the same array when nothing changed', () => {
    const current = [FINANCE, SALES];

    expect(mergeOrgUnitFieldOptions(current, [FINANCE])).toBe(current);
  });
});

describe('readOrgUnitFieldValue', () => {
  it('writes the picked unit id back', () => {
    expect(readOrgUnitFieldValue(SALES)).toBe('u2');
  });

  it('writes undefined when nothing is picked, like every optional field', () => {
    expect(readOrgUnitFieldValue(null)).toBeUndefined();
  });
});
