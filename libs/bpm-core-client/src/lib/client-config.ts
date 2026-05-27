/**
 * Programmatic configuration override for the BPM client transport.
 *
 * The default endpoint resolution (`NEXT_PUBLIC_API_URL` → localhost →
 * same-origin) covers Next.js consumers. Node-side scripts (cron
 * workers, one-off org seeds, integration tests) usually cannot rely on
 * environment variables and need a programmatic hook. Call
 * {@link configureBPMClient} once at startup; subsequent
 * `requestGraphQl` and REST auth calls honor the override.
 */

export interface BPMClientConfig {
  /**
   * Override the GraphQL endpoint URL. When provided, takes precedence
   * over `NEXT_PUBLIC_API_URL` and the default localhost / same-origin
   * resolution. Pass an absolute URL ending without `/graphql` to also
   * derive the REST `/auth/*` base URL automatically, or pass the full
   * `https://host/graphql` form to set the GraphQL endpoint directly.
   *
   * If you need different bases for GraphQL vs `/auth/*` (rare — most
   * hosts colocate them), set both `baseUrl` and `authBaseUrl`.
   */
  readonly baseUrl?: string;

  /**
   * Override the REST `/auth/*` base URL independently of `baseUrl`.
   * Most hosts colocate GraphQL and auth on the same origin; this knob
   * exists for the rare split-origin deployment.
   */
  readonly authBaseUrl?: string;

  /**
   * Replace the global `fetch` implementation. Useful when running on a
   * runtime without a global `fetch` (older Node versions, edge runtimes
   * with custom polyfills) or when you want to inject a tracing wrapper.
   */
  readonly fetch?: typeof fetch;

  /**
   * Additional headers merged into every outbound request. Use this to
   * pass service tokens, tracing headers, or a server-side session
   * cookie that the browser would normally send automatically.
   *
   * Note: `Content-Type` is set internally for GraphQL POSTs and
   * cannot be overridden through this option.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

let currentConfig: BPMClientConfig = {};

/**
 * Sets the active {@link BPMClientConfig}. Subsequent calls **replace**
 * the previous configuration; pass `{}` to reset to environment-based
 * defaults.
 *
 * Idiomatic call site is the very top of a Node worker's bootstrap:
 *
 * ```ts
 * import { configureBPMClient } from '@rytass/bpm-core-client';
 *
 * configureBPMClient({
 *   baseUrl: 'https://api.shuttle.example.com',
 *   headers: { 'X-Service-Token': process.env.BPM_SYNC_TOKEN ?? '' },
 * });
 * ```
 *
 * Browser consumers under Next.js typically do **not** need to call
 * this — `NEXT_PUBLIC_API_URL` plus same-origin defaults cover the
 * common case.
 */
export function configureBPMClient(config: BPMClientConfig): void {
  currentConfig = { ...config };
}

/**
 * Reads the active {@link BPMClientConfig}. Exposed primarily for tests
 * and for inspecting the current override at runtime — consumers should
 * use {@link configureBPMClient} to mutate, never reach in directly.
 */
export function readBPMClientConfig(): BPMClientConfig {
  return currentConfig;
}

/**
 * Resolves the effective `fetch` implementation honoring the active
 * override, falling back to the global `fetch`.
 */
export function resolveBPMFetch(): typeof fetch {
  return currentConfig.fetch ?? globalThis.fetch;
}

/**
 * Returns the headers configured via {@link configureBPMClient}.
 * Internal transports merge these into every outbound request.
 */
export function readBPMConfiguredHeaders(): Readonly<Record<string, string>> {
  return currentConfig.headers ?? {};
}
