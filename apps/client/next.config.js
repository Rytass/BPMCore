//@ts-check

const { readSecurityHeaderRules } = require('./security-headers');

/**
 * @type {import('next').NextConfig}
 **/
const nextConfig = {
  output: 'standalone',
  // next dev writes AGENTS.md and a one-line CLAUDE.md into this directory on
  // every run. The generated CLAUDE.md would change what agent sessions load
  // under apps/client, and the repo keeps its agent instructions in the root
  // CLAUDE.md, so the generator stays off.
  agentRules: false,
  // Phase 23 P4: CSP (report-only for now) and nosniff on every response.
  async headers() {
    return readSecurityHeaderRules({
      apiUrl: process.env.NEXT_PUBLIC_API_URL,
      authUrl: process.env.NEXT_PUBLIC_API_AUTH_URL,
      development: process.env.NODE_ENV === 'development',
    });
  },
};

module.exports = nextConfig;
