import { resolveFormFieldLink } from './form-field-link';

describe('resolveFormFieldLink', () => {
  it.each([
    ['/document-approval/PO/abc-123'],
    ['/'],
    ['/a/b?x=1&y=2#frag'],
    ['/path/with%20encoded'],
    ['/a/./b'],
    ['/a/../b'],
    ['/a//b'],
    ['/.hidden/file'],
  ])('keeps the site-relative path %s in this tab', (value): void => {
    expect(resolveFormFieldLink(value)).toEqual({
      external: false,
      href: value,
    });
  });

  it.each([
    ['https://example.com'],
    ['https://example.com/a/b?x=1#y'],
    ['http://example.com:8080/x'],
    ['HTTPS://EXAMPLE.COM/UPPER'],
    ['https://sub.example.co.uk/p'],
    ['http://192.168.0.1/x'],
    ['http://[::1]:3000/x'],
  ])('opens the absolute URL %s in a new tab', (value): void => {
    expect(resolveFormFieldLink(value)).toEqual({
      external: true,
      href: value,
    });
  });

  it.each([
    ['empty string', ''],
    ['bare word', 'document'],
    ['relative path without a leading slash', 'document-approval/PO/1'],
    ['dot-relative path', './x'],
    ['parent-relative path', '../x'],
    ['protocol-relative URL', '//evil.example/x'],
    ['protocol-relative with extra slashes', '///evil.example'],
    ['backslash after the slash', '/\\evil.example'],
    ['double backslash', '\\\\evil.example'],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['javascript: upper case', 'JAVASCRIPT:alert(1)'],
    ['javascript: with a protocol-looking tail', 'javascript://example.com/%0aalert(1)'],
    ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript: scheme', 'vbscript:msgbox(1)'],
    ['file: scheme', 'file:///etc/passwd'],
    ['ftp: scheme', 'ftp://example.com/x'],
    ['mailto: scheme', 'mailto:a@example.com'],
    ['http without slashes', 'http:example.com'],
    ['http with one slash', 'http:/example.com'],
    ['scheme without a host', 'https://'],
    ['credentials in the URL', 'https://user:pw@example.com/x'],
    ['username only', 'https://user@example.com/x'],
    ['leading space', ' /document-approval/PO/1'],
    ['trailing space', '/document-approval/PO/1 '],
    ['leading space before https', ' https://example.com'],
    ['inner space in a path', '/a b'],
    ['tab hiding a protocol-relative URL', '/\t/evil.example'],
    ['newline hiding a protocol-relative URL', '/\n/evil.example'],
    ['carriage return', '/a\rb'],
    ['tab inside a scheme', 'java\tscript:alert(1)'],
    ['newline inside a scheme', 'java\nscript:alert(1)'],
    ['NUL byte', '/a\u0000b'],
    ['C1 control character', '/a\u0085b'],
    ['no-break space', '/a b'],
    ['ideographic space', '　/x'],
    ['fullwidth slash (not a path separator)', '／x'],
    ['dot segment collapsing to a protocol-relative path', '/.//evil.example'],
    ['double-dot segment collapsing to a protocol-relative path', '/..//evil.example'],
    ['nested dot segments collapsing to //', '/a/..//evil.example'],
    ['encoded dot segment collapsing to //', '/%2e//evil.example'],
    ['encoded double-dot segment collapsing to //', '/%2E%2E//evil.example'],
    // These are only rejected by the `\s` branch of the checker: every code
    // point below is above U+00A0, so the numeric ranges do not cover it.
    ['ideographic space inside a path', '/a\u3000b'],
    ['en quad inside a path', '/a\u2000b'],
    ['line separator inside a path', '/a\u2028b'],
    ['paragraph separator inside a path', '/a\u2029b'],
    ['narrow no-break space inside a path', '/a\u202fb'],
    ['byte order mark inside a path (counts as whitespace)', '/a\ufeffb'],
    ['ideographic space around an absolute URL', 'https://example.com/\u3000'],
  ])('renders %s as plain text', (_label, value): void => {
    expect(resolveFormFieldLink(value)).toBeNull();
  });

  // Documents a known gap rather than a wanted behaviour: a zero-width space is
  // neither whitespace to `\s` nor a control character, so it is accepted. It
  // cannot change where the link points (the browser percent-encodes it).
  it('accepts a zero-width space inside a path', (): void => {
    expect(resolveFormFieldLink('/a\u200bb')).toEqual({
      external: false,
      href: '/a\u200bb',
    });
  });

  it.each([
    [undefined],
    [null],
    [123],
    [true],
    [['/a']],
    [{ href: '/a' }],
  ])('refuses the non-string value %p', (value): void => {
    expect(resolveFormFieldLink(value)).toBeNull();
  });
});
