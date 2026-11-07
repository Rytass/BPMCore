/**
 * The real-engine jest project (ADR 22 / docs/24 §3, P0–P1).
 *
 * The default project (`jest.config.cts`) maps `cel-js` to a JavaScript-eval
 * shim, so nothing it asserts says anything about what CEL really does. Suites
 * named `*.real-engine.spec.ts` run here instead, against the installed engines:
 * no `moduleNameMapper` for `cel-js`, and the ESM engines and their
 * dependencies are let through the transform.
 *
 * Both engines are ESM-only. Jest loads them through `require()` only under
 * `--experimental-vm-modules`, which the `test-real-engine` nx target supplies
 * from the root `.env.test` (see project.json).
 */
module.exports = {
  displayName: 'bpm-core:real-engine',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.real-engine.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.js$': 'babel-jest',
  },
  // Nothing under node_modules is transformed. `cel-js` (cel-legacy),
  // `@marcbachmann/cel-js` (cel-v2, P1) and the `chevrotain` parser are ESM, and
  // jest 30 on Node 24 loads them natively through `require(esm)` under
  // `--experimental-vm-modules`. Handing them to babel-jest gains nothing: no
  // babel config reaches node_modules, so the file comes back as ESM anyway.
  // Verified 2026-11-07: without the flag the load fails with "Must use import
  // to load ES Module" whatever this pattern says; with it, it loads.
  transformIgnorePatterns: ['/node_modules/'],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  coverageDirectory: '../../coverage/libs/bpm-core-real-engine',
};
