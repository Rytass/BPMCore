#!/usr/bin/env node
/**
 * Post-build finalizer for npm publish.
 *
 * The dist package.json files for @rytass/bpm-core-client intentionally omit
 * `"type": "commonjs"` so that Next.js webpack in this monorepo (which
 * resolves the package through a tsconfig path alias to the TypeScript
 * source) does not flag the import/export syntax as conflicting with a CJS
 * package type declaration.
 *
 * External npm consumers, however, install the published tarball — there is
 * no TypeScript source involved on their machine, and the `.js` files emitted
 * by `@nx/js:tsc` are real CommonJS. To give those consumers an explicit
 * module-type hint, this script injects `"type": "commonjs"` into the dist
 * package.json after the build but before `npm publish`.
 *
 * Usage:
 *   node tools/publish/finalize-dist-package.mjs <dist-package-dir> [...more dirs]
 *
 * Example:
 *   node tools/publish/finalize-dist-package.mjs dist/libs/bpm-core-client
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('finalize-dist-package: at least one dist directory is required');
  process.exit(1);
}

for (const dir of targets) {
  const pkgPath = resolve(dir, 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);

  if (pkg.type === 'commonjs') {
    console.log(`finalize-dist-package: ${pkg.name}@${pkg.version} already has type:commonjs`);
    continue;
  }

  const finalized = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    keywords: pkg.keywords,
    homepage: pkg.homepage,
    repository: pkg.repository,
    bugs: pkg.bugs,
    author: pkg.author,
    license: pkg.license,
    private: pkg.private,
    publishConfig: pkg.publishConfig,
    engines: pkg.engines,
    type: 'commonjs',
    main: pkg.main,
    types: pkg.types,
    typesVersions: pkg.typesVersions,
    exports: pkg.exports,
    peerDependencies: pkg.peerDependencies,
    peerDependenciesMeta: pkg.peerDependenciesMeta,
    dependencies: pkg.dependencies,
  };

  // Drop undefined keys to keep package.json clean.
  for (const key of Object.keys(finalized)) {
    if (finalized[key] === undefined) {
      delete finalized[key];
    }
  }

  writeFileSync(pkgPath, `${JSON.stringify(finalized, null, 2)}\n`, 'utf8');
  console.log(`finalize-dist-package: injected type:commonjs into ${pkg.name}@${pkg.version}`);
}
