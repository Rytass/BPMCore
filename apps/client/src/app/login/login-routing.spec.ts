import { sanitizeLoginNextPath } from './login-routing';

describe('sanitizeLoginNextPath', () => {
  it('allows same-origin absolute paths', (): void => {
    expect(sanitizeLoginNextPath('/instances/new?templateId=tpl-1')).toBe(
      '/instances/new?templateId=tpl-1',
    );
  });

  it('rejects external and protocol-relative redirects', (): void => {
    expect(sanitizeLoginNextPath('https://example.com')).toBe('/');
    expect(sanitizeLoginNextPath('//example.com/path')).toBe('/');
  });

  it('rejects backslash variants', (): void => {
    expect(sanitizeLoginNextPath('/\\example.com')).toBe('/');
    expect(sanitizeLoginNextPath('/%5Cexample.com')).toBe('/');
  });
});
