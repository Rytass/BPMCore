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

  // A bare "*" means any public https host and any path. Internal addresses
  // stay unreachable through it, like every other wildcard host.
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
    const groups = expandIpv6(normalized.replace(/[[\]]/gu, ''));

    // Not a parseable IPv6 literal: refuse to call it public.
    if (!groups) {
      return true;
    }

    const embedded = readEmbeddedIpv4(groups);

    // ::ffff:127.0.0.1, ::127.0.0.1 and 64:ff9b::127.0.0.1 all reach an IPv4
    // address, so judge the address they carry rather than the wrapper.
    if (embedded) {
      return isInternalHostname(embedded);
    }

    const [first] = groups;

    return (
      groups.every((group) => group === 0) ||
      (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) ||
      // Unique-local fc00::/7, link-local fe80::/10, deprecated site-local
      // fec0::/10 and multicast ff00::/8.
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xffc0) === 0xfec0 ||
      (first & 0xff00) === 0xff00
    );
  }

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(
    normalized,
  );

  if (!octets) {
    return false;
  }

  const [first, second] = octets.slice(1).map((value) => Number(value));

  const third = Number(octets[3]);

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    // TEST-NET-1/2/3 (192.0.2/24, 198.51.100/24, 203.0.113/24).
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    // Multicast (224/4), reserved (240/4) and broadcast are never a webhook.
    first >= 224
  );
}

/** Eight 16-bit groups, or `null` when the literal is not valid IPv6. */
function expandIpv6(literal: string): readonly number[] | null {
  const dottedTail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(literal);
  const tailGroups = dottedTail ? ipv4ToIpv6Groups(dottedTail[2]) : null;

  if (dottedTail && !tailGroups) {
    return null;
  }

  const hexLiteral =
    dottedTail && tailGroups ? `${dottedTail[1]}${tailGroups}` : literal;

  if ((hexLiteral.match(/::/gu) ?? []).length > 1) {
    return null;
  }

  const [head, tail] = hexLiteral.includes('::')
    ? hexLiteral.split('::')
    : [hexLiteral, null];
  const headGroups = head ? head.split(':') : [];
  const trailingGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - trailingGroups.length;

  if ((tail === null && missing !== 0) || missing < 0) {
    return null;
  }

  const groups = [
    ...headGroups,
    ...Array.from({ length: tail === null ? 0 : missing }, () => '0'),
    ...trailingGroups,
  ];

  return groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group))
    ? groups.map((group) => Number.parseInt(group, 16))
    : null;
}

function ipv4ToIpv6Groups(ipv4: string): string | null {
  const octets = ipv4.split('.').map((octet) => Number(octet));

  if (octets.some((octet) => octet > 255)) {
    return null;
  }

  return [
    ((octets[0] << 8) | octets[1]).toString(16),
    ((octets[2] << 8) | octets[3]).toString(16),
  ].join(':');
}

/**
 * The IPv4 address an IPv6 literal carries in its low 32 bits, for the
 * prefixes that route to it: IPv4-mapped ::ffff:0:0/96, SIIT
 * ::ffff:0:0:0/96, IPv4-compatible ::/96 and NAT64 64:ff9b::/96.
 */
function readEmbeddedIpv4(groups: readonly number[]): string | null {
  const prefix = groups.slice(0, 6);
  const zeroes = (count: number): boolean =>
    prefix.slice(0, count).every((group) => group === 0);
  const carriesIpv4 =
    (zeroes(5) && prefix[5] === 0xffff) ||
    (zeroes(4) && prefix[4] === 0xffff && prefix[5] === 0) ||
    // ::/96 minus :: and ::1, which are judged as IPv6 themselves.
    (zeroes(6) && (groups[6] !== 0 || groups[7] > 1)) ||
    (prefix[0] === 0x64 &&
      prefix[1] === 0xff9b &&
      prefix.slice(2).every((group) => group === 0));

  if (!carriesIpv4) {
    return null;
  }

  return [
    groups[6] >> 8,
    groups[6] & 0xff,
    groups[7] >> 8,
    groups[7] & 0xff,
  ].join('.');
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
