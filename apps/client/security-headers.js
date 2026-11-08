//@ts-check

/**
 * Response security headers of the client host (Phase 23 P4, docs/24 §0 and
 * p4-designer.md §9). The CSP takes the non-nonce form of the Next.js guide:
 * a nonce would force every page into dynamic rendering. It ships as
 * `Content-Security-Policy-Report-Only` first, so a violation is reported in
 * the browser console without breaking a page; turning it into the enforcing
 * header is a later, separate decision.
 *
 * Kept free of Next.js imports so a unit test can read it directly.
 */

/** Where the browser reaches the BPM API when it is not same-origin. */
const LOCAL_API_ORIGIN = 'http://localhost:17603';

/**
 * Hostnames on which `@rytass/bpm-core-client` reaches the API at
 * `LOCAL_API_ORIGIN` when `NEXT_PUBLIC_API_URL` is unset (`isLocalHost` in
 * `graphql-client.ts`), in any build mode. A Next.js `has`/`missing` host
 * value is matched as `^value$`, hence the group.
 */
const LOCAL_HOSTNAME_PATTERN = '(?:localhost|127\\.0\\.0\\.1)';

/**
 * @param {string | undefined} url
 * @returns {string | null}
 */
function readAbsoluteOrigin(url) {
  const configured = url?.trim();

  if (!configured) {
    return null;
  }

  try {
    return new URL(configured).origin;
  } catch {
    // A relative or malformed value is same-origin or unusable: nothing to add.
    return null;
  }
}

/**
 * The API origins to allow besides `'self'`, mirroring how the client picks
 * its endpoints: `NEXT_PUBLIC_API_URL` for GraphQL, `NEXT_PUBLIC_API_AUTH_URL`
 * for `/auth/*` and `/attachments/*` (the PDF preview's source), and, when no
 * API URL is set and the page is served from a local hostname, the local API
 * port. Deployed hosts without either variable reach the API same-origin.
 *
 * @param {{ readonly apiUrl?: string | undefined; readonly authUrl?: string | undefined; readonly localHost: boolean }} options
 * @returns {readonly string[]}
 */
function readApiOrigins({ apiUrl, authUrl, localHost }) {
  const apiOrigin = apiUrl?.trim()
    ? readAbsoluteOrigin(apiUrl)
    : localHost
      ? LOCAL_API_ORIGIN
      : null;
  const origins = [apiOrigin, readAbsoluteOrigin(authUrl)].filter(
    /** @returns {origin is string} */ (origin) => origin !== null,
  );

  return [...new Set(origins)];
}

/**
 * @param {{ readonly apiOrigins: readonly string[]; readonly development: boolean }} options
 * @returns {string}
 */
function readContentSecurityPolicy({ apiOrigins, development }) {
  const api = apiOrigins;
  /** @type {ReadonlyArray<readonly [string, readonly string[]]>} */
  const directives = [
    ['default-src', ["'self'"]],
    // Next.js injects inline scripts; React's dev overlay needs eval.
    [
      'script-src',
      ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])],
    ],
    // The designer and the chat drawer inject <style> elements.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...api]],
    ['font-src', ["'self'", 'data:']],
    [
      'connect-src',
      ["'self'", ...api, ...(development ? ['ws://localhost:*'] : [])],
    ],
    // `blob:` keeps form-pattern-worker on its worker (without it the worker
    // silently falls back and its timeout guard is gone); `'self'` covers the
    // pdfjs worker loaded from `new URL(..., import.meta.url)`.
    ['worker-src', ["'self'", 'blob:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];

  return directives
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * @param {{ readonly apiUrl?: string | undefined; readonly authUrl?: string | undefined; readonly development: boolean; readonly localHost: boolean }} options
 * @returns {Array<{ key: string; value: string }>}
 */
function readSecurityHeaders({ apiUrl, authUrl, development, localHost }) {
  return [
    {
      key: 'Content-Security-Policy-Report-Only',
      value: readContentSecurityPolicy({
        apiOrigins: readApiOrigins({ apiUrl, authUrl, localHost }),
        development,
      }),
    },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
  ];
}

/**
 * The `headers()` rules of next.config.js: one for pages served from a local
 * hostname, one for every other host, since the API origin the browser uses
 * depends on the hostname, not on the build mode.
 *
 * @param {{ readonly apiUrl?: string | undefined; readonly authUrl?: string | undefined; readonly development: boolean }} options
 */
function readSecurityHeaderRules({ apiUrl, authUrl, development }) {
  const host = /** @type {const} */ ({
    type: 'host',
    value: LOCAL_HOSTNAME_PATTERN,
  });

  return [
    {
      has: [host],
      headers: readSecurityHeaders({
        apiUrl,
        authUrl,
        development,
        localHost: true,
      }),
      source: '/:path*',
    },
    {
      headers: readSecurityHeaders({
        apiUrl,
        authUrl,
        development,
        localHost: false,
      }),
      missing: [host],
      source: '/:path*',
    },
  ];
}

module.exports = {
  LOCAL_HOSTNAME_PATTERN,
  readApiOrigins,
  readContentSecurityPolicy,
  readSecurityHeaderRules,
  readSecurityHeaders,
};
