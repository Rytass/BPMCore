//@ts-check

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
};

module.exports = nextConfig;
