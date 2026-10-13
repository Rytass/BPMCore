import { readAttachmentRequestOrigin } from './attachment-request-origin';

describe('readAttachmentRequestOrigin', () => {
  it('reads the socket protocol and Host header', (): void => {
    expect(
      readAttachmentRequestOrigin({
        headers: { host: 'localhost:17603' },
        protocol: 'http',
      }),
    ).toBe('http://localhost:17603');
  });

  it('prefers the outermost proxy headers', (): void => {
    expect(
      readAttachmentRequestOrigin({
        headers: {
          host: '10.12.7.36:6001',
          'x-forwarded-host': 'bpm.example.com, internal.local',
          'x-forwarded-proto': 'https, http',
        },
        protocol: 'http',
      }),
    ).toBe('https://bpm.example.com');
  });

  it('accepts an IPv6 host with a port', (): void => {
    expect(
      readAttachmentRequestOrigin({ headers: { host: '[::1]:17603' } }),
    ).toBe('http://[::1]:17603');
  });

  it.each([
    ['a host carrying a path', { host: 'evil.com/x' }],
    ['a host carrying credentials', { host: 'user@evil.com' }],
    [
      'a non-HTTP protocol',
      { host: 'bpm.example.com', 'x-forwarded-proto': 'javascript' },
    ],
    ['no host at all', {}],
  ])('returns null for %s', (_label, headers): void => {
    expect(readAttachmentRequestOrigin({ headers })).toBeNull();
  });

  it('returns null without a request', (): void => {
    expect(readAttachmentRequestOrigin(undefined)).toBeNull();
  });
});
