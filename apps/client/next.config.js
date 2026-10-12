//@ts-check

const { composePlugins, withNx } = require('@nx/next');

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  output: 'standalone',
  // next dev writes AGENTS.md and a one-line CLAUDE.md into this directory on
  // every run. The generated CLAUDE.md would change what agent sessions load
  // under apps/client, and the repo keeps its agent instructions in the root
  // CLAUDE.md, so the generator stays off.
  agentRules: false,
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);
