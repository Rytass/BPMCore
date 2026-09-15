import {
  isInternalHostname,
  isWorkflowWebhookUrlAllowed,
  parseWorkflowWebhookUrlPattern,
  parseWorkflowWebhookUrlPatterns,
} from './workflow-webhook-allowlist';

function allows(patterns: readonly string[], url: string): boolean {
  const { errors, patterns: parsed } =
    parseWorkflowWebhookUrlPatterns(patterns);

  expect(errors).toEqual([]);

  return isWorkflowWebhookUrlAllowed(url, parsed);
}

describe('workflow webhook URL allowlist', () => {
  it('matches an exact URL and rejects a different path', () => {
    const pattern = ['https://erp.example.com/hooks/bpm'];

    expect(allows(pattern, 'https://erp.example.com/hooks/bpm')).toBe(true);
    expect(allows(pattern, 'https://erp.example.com/hooks/bpm/extra')).toBe(
      false,
    );
    expect(allows(pattern, 'https://erp.example.com/other')).toBe(false);
  });

  it('treats a trailing * as a path wildcard, including query strings', () => {
    const pattern = ['https://erp.example.com/hooks/*'];

    expect(allows(pattern, 'https://erp.example.com/hooks/bpm')).toBe(true);
    expect(allows(pattern, 'https://erp.example.com/hooks/a/b?c=1')).toBe(true);
    expect(allows(pattern, 'https://erp.example.com/other/bpm')).toBe(false);
  });

  it('keeps a single * inside one host label', () => {
    const pattern = ['https://*.example.com/*'];

    expect(allows(pattern, 'https://erp.example.com/hooks')).toBe(true);
    expect(allows(pattern, 'https://erp.apac.example.com/hooks')).toBe(false);
    expect(allows(pattern, 'https://example.com/hooks')).toBe(false);
    expect(allows(pattern, 'https://erp.example.com.evil.test/hooks')).toBe(
      false,
    );
  });

  it('lets ** cross labels and include the apex', () => {
    const pattern = ['https://**.example.com/*'];

    expect(allows(pattern, 'https://example.com/hooks')).toBe(true);
    expect(allows(pattern, 'https://erp.apac.example.com/hooks')).toBe(true);
    expect(allows(pattern, 'https://example.com.evil.test/hooks')).toBe(false);
  });

  it('requires the scheme to be written out for http', () => {
    expect(allows(['erp.example.com/*'], 'https://erp.example.com/x')).toBe(
      true,
    );
    expect(allows(['erp.example.com/*'], 'http://erp.example.com/x')).toBe(
      false,
    );
    expect(
      allows(['http://erp.example.com/*'], 'http://erp.example.com/x'),
    ).toBe(true);
    expect(
      allows(['https://erp.example.com/*'], 'ftp://erp.example.com/x'),
    ).toBe(false);
  });

  it('matches the effective port', () => {
    expect(
      allows(['https://erp.example.com/*'], 'https://erp.example.com:443/x'),
    ).toBe(true);
    expect(
      allows(['https://erp.example.com/*'], 'https://erp.example.com:8443/x'),
    ).toBe(false);
    expect(
      allows(
        ['https://erp.example.com:8443/*'],
        'https://erp.example.com:8443/x',
      ),
    ).toBe(true);
  });

  it('only reaches an internal address when the pattern names that host', () => {
    expect(allows(['*'], 'https://erp.example.com/hooks')).toBe(true);
    expect(allows(['*'], 'https://localhost/hooks')).toBe(false);
    expect(allows(['*'], 'https://10.0.0.5/hooks')).toBe(false);
    expect(allows(['https://**.internal/*'], 'https://192.168.0.9/x')).toBe(
      false,
    );
    expect(
      allows(['http://localhost:17603/*'], 'http://localhost:17603/demo/sink'),
    ).toBe(true);
    expect(allows(['http://10.0.0.5/*'], 'http://10.0.0.5/hooks')).toBe(true);
  });

  it('rejects credentials on both sides', () => {
    expect(
      allows(
        ['https://erp.example.com/*'],
        'https://user:pass@erp.example.com/x',
      ),
    ).toBe(false);
    expect(() =>
      parseWorkflowWebhookUrlPattern('https://user@erp.example.com/*'),
    ).toThrow(/credentials/u);
  });

  it('rejects a malformed URL rather than throwing', () => {
    expect(allows(['*'], 'not-a-url')).toBe(false);
    expect(allows(['*'], '')).toBe(false);
  });

  it('reports invalid patterns with their index', () => {
    const result = parseWorkflowWebhookUrlPatterns([
      'https://ok.example.com/*',
      '',
      'ws://erp.example.com/*',
      'https://er*p.example.com/*',
      'https://a.**.example.com/*',
    ]);

    expect(result.patterns).toHaveLength(1);
    expect(result.errors).toEqual([
      'workflowWebhookAllowedUrlPatterns[1] is empty',
      'workflowWebhookAllowedUrlPatterns[2] "ws://erp.example.com/*" must use http:// or https://',
      'workflowWebhookAllowedUrlPatterns[3] "https://er*p.example.com/*" may only use * as a whole host label, not part of one',
      'workflowWebhookAllowedUrlPatterns[4] "https://a.**.example.com/*" may only use ** as the first host label',
    ]);
  });

  it('classifies internal hostnames', () => {
    [
      'localhost',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '[::1]',
      'api.localhost',
    ].forEach((hostname) => expect(isInternalHostname(hostname)).toBe(true));
    [
      '[::ffff:127.0.0.1]',
      '[0:0:0:0:0:ffff:7f00:1]',
      '[::7f00:1]',
      '[64:ff9b::7f00:1]',
      '[::ffff:0:7f00:1]',
      '[fec0::1]',
      '[ff02::1]',
      '[::]',
      '192.0.2.10',
      '198.51.100.10',
      '203.0.113.10',
      '[not:an:address]',
      '[::ffff:7f00:1]',
      '[::ffff:a9fe:a9fe]',
      '169.254.169.254',
      '100.64.0.1',
      '192.0.0.8',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ].forEach((hostname) => expect(isInternalHostname(hostname)).toBe(true));
    [
      'erp.example.com',
      '8.8.8.8',
      '172.32.0.1',
      '11.0.0.1',
      '[::ffff:808:808]',
      '[2001:4860:4860::8888]',
      '[64:ff9b::808:808]',
    ].forEach((hostname) => expect(isInternalHostname(hostname)).toBe(false));
  });
});
