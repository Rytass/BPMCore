/**
 * URL allowlist for webhook endpoints (ADR 18 §3.13).
 *
 * Pure functions: parsing happens once at boot so a malformed pattern fails
 * the application rather than silently allowing or denying everything, and
 * matching is called again on every delivery attempt so tightening the list
 * takes effect on deliveries that are already queued.
 */

export type WorkflowWebhookUrlScheme = 'http' | 'https';

export interface ParsedWorkflowWebhookUrlPattern {
  /** Matches the URL's effective port (the scheme default when implicit). */
  readonly port: string;
  readonly scheme: WorkflowWebhookUrlScheme;
  /** The pattern as written, for diagnostics. */
  readonly source: string;
  /**
   * `true` when the host part carries no wildcard. Only an exact host may opt
   * into a loopback or private address.
   */
  readonly hasLiteralHost: boolean;
  readonly hostMatcher: RegExp;
  readonly pathMatcher: RegExp;
  readonly hostname: string;
}

export interface WorkflowWebhookUrlPatternParseResult {
  readonly errors: readonly string[];
  readonly patterns: readonly ParsedWorkflowWebhookUrlPattern[];
}

const DEFAULT_PORTS: Readonly<Record<WorkflowWebhookUrlScheme, string>> = {
  http: '80',
  https: '443',
};

const LOOPBACK_HOSTNAMES: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '[::]',
];

export function parseWorkflowWebhookUrlPatterns(
  patterns: readonly string[],
): WorkflowWebhookUrlPatternParseResult {
  const results = patterns.map((pattern, index) => {
    try {
      return { pattern: parseWorkflowWebhookUrlPattern(pattern) };
    } catch (error: unknown) {
      return {
        error: `workflowWebhookAllowedUrlPatterns[${index}] ${
          error instanceof Error ? error.message : 'is invalid'
        }`,
      };
    }
  });

  return {
    errors: results.flatMap((result) => (result.error ? [result.error] : [])),
    patterns: results.flatMap((result) =>
      result.pattern ? [result.pattern] : [],
    ),
  };
}

export function parseWorkflowWebhookUrlPattern(
  pattern: string,
): ParsedWorkflowWebhookUrlPattern {
  const trimmed = pattern.trim();

  if (!trimmed) {
    throw new Error('is empty');
  }

  // A bare "*" is the escape hatch for development: any https host, any path.
  const normalized = trimmed === '*' ? 'https://**/*' : trimmed;
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//u.exec(normalized);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : 'https';

  if (scheme !== 'http' && scheme !== 'https') {
    throw new Error(`"${pattern}" must use http:// or https://`);
  }

  const remainder = schemeMatch
    ? normalized.slice(schemeMatch[0].length)
    : normalized;
  const slashIndex = remainder.indexOf('/');
  const authority =
    slashIndex === -1 ? remainder : remainder.slice(0, slashIndex);
  const path = slashIndex === -1 ? '/*' : remainder.slice(slashIndex);

  if (!authority) {
    throw new Error(`"${pattern}" is missing a host`);
  }

  if (authority.includes('@')) {
    throw new Error(`"${pattern}" must not carry credentials`);
  }

  const portMatch = /:([0-9*]+)$/u.exec(authority);
  const hostname = (
    portMatch ? authority.slice(0, -portMatch[0].length) : authority
  ).toLowerCase();
  const port = portMatch ? portMatch[1] : DEFAULT_PORTS[scheme];

  if (!hostname) {
    throw new Error(`"${pattern}" is missing a host`);
  }

  if (!/^[A-Za-z0-9*.\-[\]:]+$/u.test(hostname)) {
    throw new Error(`"${pattern}" has an invalid host`);
  }

  return {
    hasLiteralHost: !hostname.includes('*'),
    hostMatcher: buildHostMatcher(hostname, pattern),
    hostname,
    pathMatcher: buildPathMatcher(path),
    port,
    scheme,
    source: pattern,
  };
}

/**
 * Whether `url` may be called. An empty pattern list denies everything: the
 * caller decides whether an unconfigured allowlist means "deny" (the database
 * source) or "not enforced" (the registry source), and conflating the two here
 * would turn a missing configuration into an open door.
 */
export function isWorkflowWebhookUrlAllowed(
  url: string,
  patterns: readonly ParsedWorkflowWebhookUrlPattern[],
): boolean {
  const parsed = parseUrl(url);

  if (!parsed) {
    return false;
  }

  return patterns.some((pattern) => matchesPattern(parsed, pattern));
}

interface ParsedUrl {
  readonly hostname: string;
  readonly path: string;
  readonly port: string;
  readonly scheme: WorkflowWebhookUrlScheme;
}

function parseUrl(url: string): ParsedUrl | null {
  const candidate = ((): URL | null => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();

  if (!candidate) {
    return null;
  }

  const scheme = candidate.protocol.replace(':', '').toLowerCase();

  if (scheme !== 'http' && scheme !== 'https') {
    return null;
  }

  // Credentials in the URL are never legitimate here and would let an
  // otherwise-allowed host smuggle a different authority past a reader.
  if (candidate.username || candidate.password) {
    return null;
  }

  return {
    hostname: candidate.hostname.toLowerCase(),
    path: `${candidate.pathname}${candidate.search}`,
    port: candidate.port || DEFAULT_PORTS[scheme],
    scheme,
  };
}

function matchesPattern(
  url: ParsedUrl,
  pattern: ParsedWorkflowWebhookUrlPattern,
): boolean {
  if (url.scheme !== pattern.scheme) {
    return false;
  }

  if (pattern.port !== '*' && url.port !== pattern.port) {
    return false;
  }

  if (!pattern.hostMatcher.test(url.hostname)) {
    return false;
  }

  // A wildcard host must never reach the loopback interface, a private range
  // or a bare IP: those are the addresses an SSRF is after, and a pattern that
  // names them explicitly is the only way to opt in.
  if (!pattern.hasLiteralHost && isInternalHostname(url.hostname)) {
    return false;
  }

  return pattern.pathMatcher.test(url.path);
}

export function isInternalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (LOOPBACK_HOSTNAMES.includes(normalized)) {
    return true;
  }

  if (normalized.endsWith('.localhost')) {
    return true;
  }

  if (normalized.includes(':')) {
    // IPv6 literal: loopback, unique-local (fc00::/7) and link-local
    // (fe80::/10) are all internal.
    const compact = normalized.replace(/[[\]]/gu, '');

    return (
      compact === '::1' ||
      compact === '::' ||
      /^f[cd][0-9a-f]{2}:/u.test(compact) ||
      /^fe[89ab][0-9a-f]:/u.test(compact)
    );
  }

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(
    normalized,
  );

  if (!octets) {
    return false;
  }

  const [first, second] = octets.slice(1).map((value) => Number(value));

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function buildHostMatcher(hostname: string, pattern: string): RegExp {
  const labels = hostname.split('.');

  // "**" on its own is the any-host wildcard, which the bare "*" pattern
  // normalizes to; every other use is a subdomain prefix.
  if (labels.length === 1 && labels[0] === '**') {
    return /^[a-z0-9.-]+$/u;
  }

  const parts = labels.map((label, index) => {
    if (label === '**') {
      if (index !== 0) {
        throw new Error(`"${pattern}" may only use ** as the first host label`);
      }

      // Zero or more labels, so **.example.com also matches example.com.
      return '(?:[a-z0-9-]+\\.)*';
    }

    if (label === '*') {
      return `[a-z0-9-]+${index === labels.length - 1 ? '' : '\\.'}`;
    }

    if (label.includes('*')) {
      throw new Error(
        `"${pattern}" may only use * as a whole host label, not part of one`,
      );
    }

    return `${escapeRegExp(label)}${index === labels.length - 1 ? '' : '\\.'}`;
  });

  return new RegExp(`^${parts.join('')}$`, 'u');
}

function buildPathMatcher(path: string): RegExp {
  const escaped = path
    .split('*')
    .map((segment) => escapeRegExp(segment))
    .join('.*');

  return new RegExp(`^${escaped}$`, 'u');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
