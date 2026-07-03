import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { libInjectCss } from 'vite-plugin-lib-inject-css';
import preserveDirectives from 'rollup-preserve-directives';

// Planned subpath catalog. Each entry maps to one consumer-facing subpath
// (matching `package.json#exports`). Parallel agents add new source files
// without touching this list; the actual Vite entries are filtered down to
// the ones whose source file exists on disk so foundation builds stay green
// while domain views are still being ported.
const PLANNED_ENTRIES: Readonly<Record<string, string>> = {
  index: 'src/index.ts',

  // Next.js drop-in provider shim (consumer's layout uses this once).
  'next/index': 'src/next/index.ts',

  // Next.js route handler for the workflow designer LLM assistant.
  'next/workflow-chat-route': 'src/next/workflow-chat-route.ts',

  // Grouped view barrels — preferred entry point for most consumers.
  // Heavy views (designer / builder / instance detail) stay isolated.
  'views/workflow/index': 'src/views/workflow/index.ts',
  'views/instances/index': 'src/views/instances/index.ts',
  'views/settings/index': 'src/views/settings/index.ts',
  'views/admin/index': 'src/views/admin/index.ts',

  // Leaf view entries — kept for surgical tree-shaking and for heavy views
  // that must not be bundled with their lighter siblings.
  'views/login/index': 'src/views/login/index.ts',
  'views/dashboard/index': 'src/views/dashboard/index.ts',
  'views/inbox/index': 'src/views/inbox/index.ts',
  'views/sent/index': 'src/views/sent/index.ts',
  'views/cc/index': 'src/views/cc/index.ts',
  'views/search/index': 'src/views/search/index.ts',
  'views/delegations/index': 'src/views/delegations/index.ts',
  'views/instances/detail/index': 'src/views/instances/detail/index.ts',
  'views/instances/new/index': 'src/views/instances/new/index.ts',
  'views/templates/index': 'src/views/templates/index.ts',
  'views/templates/categories/index': 'src/views/templates/categories/index.ts',
  'views/templates/compose/index': 'src/views/templates/compose/index.ts',
  'views/templates/designer/index': 'src/views/templates/designer/index.ts',
  'views/templates/versions/index': 'src/views/templates/versions/index.ts',
  'views/forms/builder/index': 'src/views/forms/builder/index.ts',
  'views/forms/renderer/index': 'src/views/forms/renderer/index.ts',
  'views/settings/notifications/index': 'src/views/settings/notifications/index.ts',
  'views/admin/users/index': 'src/views/admin/users/index.ts',
  'views/admin/orgs/index': 'src/views/admin/orgs/index.ts',
  'views/admin/delegations/index': 'src/views/admin/delegations/index.ts',

  // Next.js Server Component shims (export `{ default, metadata }`).
  'pages/root/index': 'src/pages/root/index.tsx',
  'pages/login/index': 'src/pages/login/index.tsx',
  'pages/dashboard/index': 'src/pages/dashboard/index.tsx',
  'pages/inbox/index': 'src/pages/inbox/index.tsx',
  'pages/sent/index': 'src/pages/sent/index.tsx',
  'pages/cc/index': 'src/pages/cc/index.tsx',
  'pages/search/index': 'src/pages/search/index.tsx',
  'pages/delegations/index': 'src/pages/delegations/index.tsx',
  'pages/instances/detail/index': 'src/pages/instances/detail/index.tsx',
  'pages/instances/new/index': 'src/pages/instances/new/index.tsx',
  'pages/templates/index': 'src/pages/templates/index.tsx',
  'pages/templates/categories/index': 'src/pages/templates/categories/index.tsx',
  'pages/templates/compose/index': 'src/pages/templates/compose/index.tsx',
  'pages/templates/designer/index': 'src/pages/templates/designer/index.tsx',
  'pages/templates/versions/index': 'src/pages/templates/versions/index.tsx',
  'pages/settings/notifications/index': 'src/pages/settings/notifications/index.tsx',
  'pages/admin/users/index': 'src/pages/admin/users/index.tsx',
  'pages/admin/orgs/index': 'src/pages/admin/orgs/index.tsx',
  'pages/admin/delegations/index': 'src/pages/admin/delegations/index.tsx',
};

const entries: Record<string, string> = Object.fromEntries(
  Object.entries(PLANNED_ENTRIES).filter(([, sourcePath]) =>
    existsSync(resolve(__dirname, sourcePath)),
  ),
);

export default defineConfig({
  plugins: [
    react(),
    libInjectCss(),
    preserveDirectives(),
    dts({
      entryRoot: 'src',
      outDir: 'dist',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.spec.tsx',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
      rollupTypes: false,
      tsconfigPath: 'tsconfig.lib.json',
      // Without this, vite-plugin-dts resolves the monorepo path aliases
      // from tsconfig.base.json (e.g. `@rytass/bpm-core-client` →
      // `libs/bpm-core-client/src/index.ts`) into the emitted .d.ts files
      // as relative paths that escape the published tarball. Strip the
      // path map for the publish build so import specifiers stay as the
      // original package names.
      compilerOptions: { paths: {} },
    }),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: true,
    sourcemap: true,
    lib: {
      entry: entries,
    },
    rollupOptions: {
      external: (id): boolean => {
        if (id.startsWith('react') || id.startsWith('next')) return true;
        if (id === 'ai' || id.startsWith('@ai-sdk/')) return true;
        if (id.startsWith('@rytass/bpm-core-')) return true;
        if (id.startsWith('@mezzanine-ui/')) return true;
        // Keep the xyflow JS external but bundle its stylesheet
        // (`@xyflow/react/dist/style.css`) into the extracted css chunks —
        // xyflow v12 does no runtime style injection, so consumers that don't
        // import the stylesheet themselves get an unpositioned, broken graph.
        if (id.startsWith('@xyflow/')) return !/\.css(\?|$)/.test(id);
        if (id.startsWith('@codemirror/')) return true;
        if (id.startsWith('@uiw/')) return true;
        if (id.startsWith('@hello-pangea/')) return true;
        if (id === 'moment' || id === 'clsx' || id === 'dagre') return true;
        if (id === 'pdfjs-dist' || id === 'react-pdf') return true;
        return false;
      },
      output: [
        {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (asset): string =>
            asset.name?.endsWith('.css') ? '[name][extname]' : 'assets/[name][extname]',
          exports: 'named',
          preserveModules: false,
        },
        {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs',
          assetFileNames: (asset): string =>
            asset.name?.endsWith('.css') ? '[name][extname]' : 'assets/[name][extname]',
          exports: 'named',
          preserveModules: false,
        },
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: 'bpm_[local]_[hash:base64:5]',
    },
  },
});
