import { formatMemberLabel } from './format-member-label';

describe('formatMemberLabel', (): void => {
  it('puts the e-mail in ASCII parentheses by default', (): void => {
    expect(formatMemberLabel('王小明', 'ming@example.com')).toBe(
      '王小明 (ming@example.com)',
    );
  });

  it('keeps the fullwidth and dot styles when asked for', (): void => {
    expect(formatMemberLabel('王小明', 'ming@example.com', 'fullwidth')).toBe(
      '王小明（ming@example.com）',
    );
    expect(formatMemberLabel('王小明', 'ming@example.com', 'dot')).toBe(
      '王小明 · ming@example.com',
    );
  });

  it.each(['', '   ', '\t\n', null, undefined])(
    'shows only the name when the e-mail is %j',
    (email): void => {
      expect(formatMemberLabel('王小明', email)).toBe('王小明');
      expect(formatMemberLabel('王小明', email, 'fullwidth')).toBe('王小明');
      expect(formatMemberLabel('王小明', email, 'dot')).toBe('王小明');
    },
  );
});
